//! System font enumeration for the settings font pickers.

use crate::error::AppError;
use std::sync::OnceLock;

/// Distinct font family names installed on the system, sorted
/// case-insensitively. Enumerated once per process and cached — a newly
/// installed font shows up after an app restart, which is acceptable for a
/// settings picker.
#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, AppError> {
    static FONTS: OnceLock<Vec<String>> = OnceLock::new();
    if let Some(fonts) = FONTS.get() {
        return Ok(fonts.clone());
    }
    let fonts = tauri::async_runtime::spawn_blocking(load_family_names)
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(FONTS.get_or_init(|| fonts).clone())
}

fn load_family_names() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut families: Vec<String> = db
        .faces()
        .filter_map(|face| face.families.first().map(|(name, _)| name.clone()))
        // Leading-dot families are macOS-internal (".SF NS", ".Al Bayan PUA",
        // …) — hidden from native font pickers, so hide them here too.
        .filter(|name| !name.starts_with('.'))
        .collect();
    // Case-insensitive order for display, with a case-sensitive tiebreak so
    // equal names land adjacent and `dedup` can drop them.
    families.sort_by(|a, b| (a.to_lowercase(), a).cmp(&(b.to_lowercase(), b)));
    families.dedup();
    families
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_family_names_returns_sorted_unique_families() {
        let families = load_family_names();
        assert!(!families.is_empty(), "expected system fonts to exist");
        let mut expected = families.clone();
        expected.sort_by(|a, b| (a.to_lowercase(), a).cmp(&(b.to_lowercase(), b)));
        expected.dedup();
        assert_eq!(families, expected);
        assert!(
            families.iter().all(|name| !name.starts_with('.')),
            "hidden system families should be filtered out"
        );
    }
}
