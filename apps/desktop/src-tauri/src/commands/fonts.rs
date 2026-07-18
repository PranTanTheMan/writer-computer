//! macOS system Font panel integration for typography settings.

use crate::error::AppError;
use crate::macos::{app_delegate, ns_string, ns_string_to_string};
use objc2::ffi::class_addMethod;
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::{class, msg_send, sel};
use serde::Serialize;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use tauri::Emitter;

const FONT_SELECTED_EVENT: &str = "font:selected";
const FONT_ACTION_SIGNATURE: &[u8] = b"v@:@\0";
// NSFontPanelModeMask is NSUInteger (64-bit on every supported macOS target).
const FONT_PANEL_MODES_SIGNATURE: &[u8] = b"Q@:@\0";
const DEFAULT_FONT_SIZE: f64 = 13.0;
const NORMAL_FONT_WEIGHT: isize = 5;

static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
static METHODS_REGISTERED: AtomicBool = AtomicBool::new(false);
static ROUTER: OnceLock<Mutex<FontRequestRouter>> = OnceLock::new();

#[derive(Clone, Debug, PartialEq, Eq)]
struct ActiveFontRequest {
    window_label: String,
    request_id: String,
    last_family: String,
}

#[derive(Default)]
struct FontRequestRouter {
    active: Option<ActiveFontRequest>,
}

impl FontRequestRouter {
    fn activate(&mut self, window_label: String, request_id: String, family: String) {
        self.active = Some(ActiveFontRequest {
            window_label,
            request_id,
            last_family: family,
        });
    }

    fn route_selection(&mut self, family: &str) -> Option<ActiveFontRequest> {
        let active = self.active.as_mut()?;
        if active.last_family == family {
            return None;
        }
        active.last_family = family.to_owned();
        Some(active.clone())
    }

    fn deactivate(&mut self, window_label: &str, request_id: &str) -> bool {
        let matches = self.active.as_ref().is_some_and(|active| {
            active.window_label == window_label && active.request_id == request_id
        });
        if matches {
            self.active = None;
        }
        matches
    }

    fn deactivate_window(&mut self, window_label: &str) -> bool {
        let matches = self
            .active
            .as_ref()
            .is_some_and(|active| active.window_label == window_label);
        if matches {
            self.active = None;
        }
        matches
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FontSelectionPayload {
    request_id: String,
    family: String,
}

fn router() -> &'static Mutex<FontRequestRouter> {
    ROUTER.get_or_init(|| Mutex::new(FontRequestRouter::default()))
}

fn lock_router() -> MutexGuard<'static, FontRequestRouter> {
    router()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Register Writer's font-manager selectors on Tauri's lifetime-stable app
/// delegate. `NSFontManager.target` is weak, so a temporary target object would
/// become a dangling callback destination.
pub(crate) fn install(app: &tauri::AppHandle) {
    let _ = APP_HANDLE.set(app.clone());
    if METHODS_REGISTERED.load(Ordering::Acquire) {
        return;
    }

    let registered = unsafe { register_delegate_methods() };
    if registered {
        METHODS_REGISTERED.store(true, Ordering::Release);
    }
}

unsafe fn register_delegate_methods() -> bool {
    let Some(delegate) = (unsafe { app_delegate() }) else {
        eprintln!("failed to install Font panel: application delegate unavailable");
        return false;
    };
    let delegate_class: *mut AnyClass = unsafe { msg_send![delegate, class] };
    if delegate_class.is_null() {
        eprintln!("failed to install Font panel: delegate class unavailable");
        return false;
    }

    let action_imp: Imp = unsafe {
        std::mem::transmute::<unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject), Imp>(
            font_manager_changed,
        )
    };
    let action_added = unsafe {
        class_addMethod(
            delegate_class,
            sel!(writerFontManagerChanged:),
            action_imp,
            FONT_ACTION_SIGNATURE.as_ptr().cast(),
        )
        .as_bool()
    };
    if !action_added {
        eprintln!("failed to install Font panel: action selector could not be added");
        return false;
    }

    // A zero mode mask leaves the family list while hiding collection, face,
    // size, and effect controls that Writer's family-stack setting cannot store.
    let modes_imp: Imp = unsafe {
        std::mem::transmute::<
            unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize,
            Imp,
        >(valid_font_panel_modes)
    };
    let modes_added = unsafe {
        class_addMethod(
            delegate_class,
            sel!(validModesForFontPanel:),
            modes_imp,
            FONT_PANEL_MODES_SIGNATURE.as_ptr().cast(),
        )
        .as_bool()
    };
    if !modes_added {
        eprintln!("Font panel mode validation unavailable; using the standard panel layout");
    }

    true
}

unsafe extern "C-unwind" fn valid_font_panel_modes(
    _delegate: *mut AnyObject,
    _cmd: Sel,
    _panel: *mut AnyObject,
) -> usize {
    0
}

unsafe extern "C-unwind" fn font_manager_changed(
    _delegate: *mut AnyObject,
    _cmd: Sel,
    sender: *mut AnyObject,
) {
    if sender.is_null() {
        return;
    }

    let selected_font: *mut AnyObject = unsafe { msg_send![sender, selectedFont] };
    if selected_font.is_null() {
        return;
    }
    let converted_font: *mut AnyObject = unsafe { msg_send![sender, convertFont: selected_font] };
    if converted_font.is_null() {
        return;
    }
    let family_name: *mut AnyObject = unsafe { msg_send![converted_font, familyName] };
    let Some(family) = (unsafe { ns_string_to_string(family_name) }) else {
        return;
    };

    // Make the converted font the baseline for the next panel action. This is
    // state synchronization only; it does not send another change action.
    unsafe {
        let _: () = msg_send![sender, setSelectedFont: converted_font, isMultiple: false];
    }

    let route = lock_router().route_selection(&family);
    let Some(route) = route else { return };
    let Some(app) = APP_HANDLE.get() else { return };
    if let Err(error) = app.emit_to(
        &route.window_label,
        FONT_SELECTED_EVENT,
        FontSelectionPayload {
            request_id: route.request_id,
            family,
        },
    ) {
        eprintln!("failed to emit native font selection: {error}");
    }
}

/// Open the shared Font panel for the calling webview. The complete AppKit
/// setup and route publication happen in one main-thread transaction; the
/// oneshot carries setup failures back across the IPC boundary.
#[tauri::command]
pub async fn open_native_font_panel(
    request_id: String,
    family: String,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let window_label = webview.label().to_owned();
    let (result_tx, result_rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let result = open_on_main_thread(window_label, request_id, family);
        let _ = result_tx.send(result);
    })
    .map_err(|error| AppError::Io(format!("Could not schedule Font panel: {error}")))?;

    result_rx
        .await
        .map_err(|_| AppError::Io("Font panel setup was cancelled".into()))?
}

fn open_on_main_thread(
    window_label: String,
    request_id: String,
    family: String,
) -> Result<(), AppError> {
    if !METHODS_REGISTERED.load(Ordering::Acquire) {
        return Err(AppError::Io("Font panel bridge is unavailable".into()));
    }

    let Some(delegate) = (unsafe { app_delegate() }) else {
        return Err(AppError::Io("Application delegate is unavailable".into()));
    };
    let manager: *mut AnyObject = unsafe { msg_send![class!(NSFontManager), sharedFontManager] };
    if manager.is_null() {
        return Err(AppError::Io("System font manager is unavailable".into()));
    }

    let family_name = unsafe { ns_string(&family) };
    let mut font: *mut AnyObject = ptr::null_mut();
    if !family_name.is_null() {
        font = unsafe {
            msg_send![
                manager,
                fontWithFamily: family_name,
                traits: 0usize,
                weight: NORMAL_FONT_WEIGHT,
                size: DEFAULT_FONT_SIZE
            ]
        };
    }
    if font.is_null() {
        font = unsafe { msg_send![class!(NSFont), systemFontOfSize: DEFAULT_FONT_SIZE] };
    }
    if font.is_null() {
        return Err(AppError::Io("Could not initialize the Font panel".into()));
    }

    unsafe {
        let _: () = msg_send![manager, setSelectedFont: font, isMultiple: false];
        let _: () = msg_send![manager, setTarget: delegate];
        let _: () = msg_send![manager, setAction: sel!(writerFontManagerChanged:)];
    }
    lock_router().activate(window_label, request_id, family);
    unsafe {
        let _: () = msg_send![manager, orderFrontFontPanel: ptr::null::<AnyObject>()];
    }
    Ok(())
}

/// Close/deactivate only the request owned by the calling webview. A stale
/// cleanup can never dismiss a panel subsequently opened by another row/window.
#[tauri::command]
pub async fn close_native_font_panel(
    request_id: String,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let window_label = webview.label().to_owned();
    let (result_tx, result_rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        close_on_main_thread(|router| router.deactivate(&window_label, &request_id));
        let _ = result_tx.send(());
    })
    .map_err(|error| AppError::Io(format!("Could not close Font panel: {error}")))?;
    result_rx
        .await
        .map_err(|_| AppError::Io("Font panel cleanup was cancelled".into()))
}

pub(crate) fn close_for_window(app: &tauri::AppHandle, window_label: &str) {
    let window_label = window_label.to_owned();
    if let Err(error) = app.run_on_main_thread(move || {
        close_on_main_thread(|router| router.deactivate_window(&window_label));
    }) {
        eprintln!("failed to schedule Font panel cleanup: {error}");
    }
}

fn close_on_main_thread(deactivate: impl FnOnce(&mut FontRequestRouter) -> bool) {
    if !deactivate(&mut lock_router()) {
        return;
    }

    let manager: *mut AnyObject = unsafe { msg_send![class!(NSFontManager), sharedFontManager] };
    if manager.is_null() {
        return;
    }
    unsafe {
        let _: () = msg_send![manager, setTarget: ptr::null::<AnyObject>()];
        let _: () = msg_send![manager, setAction: sel!(changeFont:)];
    }
    let panel: *mut AnyObject = unsafe { msg_send![manager, fontPanel: false] };
    if !panel.is_null() {
        unsafe {
            let _: () = msg_send![panel, orderOut: ptr::null::<AnyObject>()];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(window: &str, request_id: &str, family: &str) -> ActiveFontRequest {
        ActiveFontRequest {
            window_label: window.into(),
            request_id: request_id.into(),
            last_family: family.into(),
        }
    }

    #[test]
    fn latest_request_replaces_previous_route() {
        let mut router = FontRequestRouter::default();
        router.activate("window-a".into(), "request-a".into(), "Menlo".into());
        router.activate("window-b".into(), "request-b".into(), "Monaco".into());

        assert_eq!(
            router.route_selection("Courier"),
            Some(request("window-b", "request-b", "Courier"))
        );
    }

    #[test]
    fn selection_suppresses_unchanged_family_and_snapshots_changed_route() {
        let mut router = FontRequestRouter::default();
        router.activate("window-a".into(), "request-a".into(), "Menlo".into());

        assert_eq!(router.route_selection("Menlo"), None);
        assert_eq!(
            router.route_selection("Monaco"),
            Some(request("window-a", "request-a", "Monaco"))
        );
        assert_eq!(router.route_selection("Monaco"), None);
    }

    #[test]
    fn stale_deactivation_does_not_clear_newer_request() {
        let mut router = FontRequestRouter::default();
        router.activate("window-b".into(), "request-b".into(), "Menlo".into());

        assert!(!router.deactivate("window-a", "request-a"));
        assert_eq!(
            router.route_selection("Monaco"),
            Some(request("window-b", "request-b", "Monaco"))
        );
    }

    #[test]
    fn stale_same_window_deactivation_does_not_clear_newer_row_request() {
        let mut router = FontRequestRouter::default();
        router.activate("window-a".into(), "request-a".into(), "Menlo".into());
        router.activate("window-a".into(), "request-b".into(), "Monaco".into());

        assert!(!router.deactivate("window-a", "request-a"));
        assert_eq!(
            router.route_selection("Courier"),
            Some(request("window-a", "request-b", "Courier"))
        );
    }

    #[test]
    fn matching_window_cleanup_clears_active_request() {
        let mut router = FontRequestRouter::default();
        router.activate("window-a".into(), "request-a".into(), "Menlo".into());

        assert!(router.deactivate_window("window-a"));
        assert_eq!(router.route_selection("Monaco"), None);
    }
}
