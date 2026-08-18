//! Disposable Phase 0 proof for process-wide shared-document projection ownership.
//! This intentionally does not ship a production command or alter Writer's save path.

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Barrier, Mutex,
    },
    thread,
    time::Duration,
};

#[derive(Clone, Debug, PartialEq, Eq)]
struct Attachment {
    document_id: String,
    window_instance_id: String,
    attachment_id: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ProjectionPermit {
    document_id: String,
    canonical_path: PathBuf,
    owner_attachment_id: u64,
    generation: u64,
}

#[derive(Debug, PartialEq, Eq)]
enum RegistryError {
    DocumentAlreadyBound { current_path: PathBuf },
    PathAlreadyOwned { current_document_id: String },
    MissingSession,
    MissingAttachment,
    NotProjectionOwner,
    StaleGeneration,
    Io(String),
}

struct Session {
    canonical_path: PathBuf,
    projection_generation: u64,
    projection_owner: u64,
    attachments: HashMap<u64, String>,
}

#[derive(Default)]
struct RegistryState {
    sessions_by_document: HashMap<String, Session>,
    document_by_path: HashMap<PathBuf, String>,
}

#[derive(Default)]
struct SharedDocumentRegistry {
    state: Mutex<RegistryState>,
    next_epoch: AtomicU64,
}

impl SharedDocumentRegistry {
    fn next_epoch(&self) -> u64 {
        self.next_epoch.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn canonicalize(path: &Path) -> Result<PathBuf, RegistryError> {
        fs::canonicalize(path).map_err(|error| RegistryError::Io(error.to_string()))
    }

    fn attach(
        &self,
        document_id: &str,
        projection_path: &Path,
        window_instance_id: &str,
    ) -> Result<Attachment, RegistryError> {
        let canonical_path = Self::canonicalize(projection_path)?;
        let attachment_id = self.next_epoch();
        let mut state = self.state.lock().unwrap();

        if let Some(current_document_id) = state.document_by_path.get(&canonical_path) {
            if current_document_id != document_id {
                return Err(RegistryError::PathAlreadyOwned {
                    current_document_id: current_document_id.clone(),
                });
            }
        }

        if let Some(session) = state.sessions_by_document.get_mut(document_id) {
            if session.canonical_path != canonical_path {
                return Err(RegistryError::DocumentAlreadyBound {
                    current_path: session.canonical_path.clone(),
                });
            }
            session
                .attachments
                .insert(attachment_id, window_instance_id.to_owned());
        } else {
            let generation = self.next_epoch();
            state
                .document_by_path
                .insert(canonical_path.clone(), document_id.to_owned());
            state.sessions_by_document.insert(
                document_id.to_owned(),
                Session {
                    canonical_path,
                    projection_generation: generation,
                    projection_owner: attachment_id,
                    attachments: HashMap::from([(attachment_id, window_instance_id.to_owned())]),
                },
            );
        }

        Ok(Attachment {
            document_id: document_id.to_owned(),
            window_instance_id: window_instance_id.to_owned(),
            attachment_id,
        })
    }

    fn projection_permit(
        &self,
        attachment: &Attachment,
    ) -> Result<ProjectionPermit, RegistryError> {
        let state = self.state.lock().unwrap();
        let session = state
            .sessions_by_document
            .get(&attachment.document_id)
            .ok_or(RegistryError::MissingSession)?;
        if session.attachments.get(&attachment.attachment_id)
            != Some(&attachment.window_instance_id)
        {
            return Err(RegistryError::MissingAttachment);
        }
        if session.projection_owner != attachment.attachment_id {
            return Err(RegistryError::NotProjectionOwner);
        }
        Ok(ProjectionPermit {
            document_id: attachment.document_id.clone(),
            canonical_path: session.canonical_path.clone(),
            owner_attachment_id: attachment.attachment_id,
            generation: session.projection_generation,
        })
    }

    fn rebind_path(
        &self,
        attachment: &Attachment,
        new_projection_path: &Path,
    ) -> Result<ProjectionPermit, RegistryError> {
        let new_canonical_path = Self::canonicalize(new_projection_path)?;
        let mut state = self.state.lock().unwrap();
        let (old_path, owner_attachment_id) = {
            let session = state
                .sessions_by_document
                .get(&attachment.document_id)
                .ok_or(RegistryError::MissingSession)?;
            if session.attachments.get(&attachment.attachment_id)
                != Some(&attachment.window_instance_id)
            {
                return Err(RegistryError::MissingAttachment);
            }
            if session.projection_owner != attachment.attachment_id {
                return Err(RegistryError::NotProjectionOwner);
            }
            (session.canonical_path.clone(), session.projection_owner)
        };
        if let Some(current_document_id) = state.document_by_path.get(&new_canonical_path) {
            if current_document_id != &attachment.document_id {
                return Err(RegistryError::PathAlreadyOwned {
                    current_document_id: current_document_id.clone(),
                });
            }
        }

        let generation = self.next_epoch();
        state.document_by_path.remove(&old_path);
        state
            .document_by_path
            .insert(new_canonical_path.clone(), attachment.document_id.clone());
        let session = state
            .sessions_by_document
            .get_mut(&attachment.document_id)
            .unwrap();
        session.canonical_path = new_canonical_path.clone();
        session.projection_generation = generation;
        Ok(ProjectionPermit {
            document_id: attachment.document_id.clone(),
            canonical_path: new_canonical_path,
            owner_attachment_id,
            generation,
        })
    }

    fn write_projection(
        &self,
        permit: &ProjectionPermit,
        content: &str,
    ) -> Result<(), RegistryError> {
        self.write_projection_with_hook(permit, content, || {})
    }

    fn write_projection_with_hook(
        &self,
        permit: &ProjectionPermit,
        content: &str,
        after_validation: impl FnOnce(),
    ) -> Result<(), RegistryError> {
        // Authority remains locked through the filesystem commit. A production
        // registry can replace this with a per-session writer queue, but must not
        // split validation from commit.
        let state = self.state.lock().unwrap();
        let Some(session) = state.sessions_by_document.get(&permit.document_id) else {
            return Err(RegistryError::StaleGeneration);
        };
        if session.projection_generation != permit.generation
            || session.projection_owner != permit.owner_attachment_id
            || session.canonical_path != permit.canonical_path
            || state.document_by_path.get(&permit.canonical_path) != Some(&permit.document_id)
        {
            return Err(RegistryError::StaleGeneration);
        }
        after_validation();
        fs::write(&permit.canonical_path, content)
            .map_err(|error| RegistryError::Io(error.to_string()))
    }

    fn detach(&self, attachment: &Attachment) -> Result<(), RegistryError> {
        let mut state = self.state.lock().unwrap();
        let Some(session) = state.sessions_by_document.get_mut(&attachment.document_id) else {
            return Ok(());
        };
        if session.attachments.get(&attachment.attachment_id)
            != Some(&attachment.window_instance_id)
        {
            return Ok(());
        }
        session.attachments.remove(&attachment.attachment_id);
        self.finish_attachment_removal(
            &mut state,
            &attachment.document_id,
            attachment.attachment_id,
        );
        Ok(())
    }

    fn release_window(&self, window_instance_id: &str) {
        let mut state = self.state.lock().unwrap();
        let removals: Vec<_> = state
            .sessions_by_document
            .iter()
            .flat_map(|(document_id, session)| {
                session
                    .attachments
                    .iter()
                    .filter(|(_, window)| window.as_str() == window_instance_id)
                    .map(|(attachment_id, _)| (document_id.clone(), *attachment_id))
                    .collect::<Vec<_>>()
            })
            .collect();
        for (document_id, attachment_id) in removals {
            if let Some(session) = state.sessions_by_document.get_mut(&document_id) {
                session.attachments.remove(&attachment_id);
            }
            self.finish_attachment_removal(&mut state, &document_id, attachment_id);
        }
    }

    fn finish_attachment_removal(
        &self,
        state: &mut RegistryState,
        document_id: &str,
        removed_attachment_id: u64,
    ) {
        let Some(session) = state.sessions_by_document.get_mut(document_id) else {
            return;
        };
        if session.attachments.is_empty() {
            let path = session.canonical_path.clone();
            state.sessions_by_document.remove(document_id);
            state.document_by_path.remove(&path);
        } else if session.projection_owner == removed_attachment_id {
            session.projection_owner = *session.attachments.keys().min().unwrap();
            session.projection_generation = self.next_epoch();
        }
    }

    fn session_count(&self) -> usize {
        self.state.lock().unwrap().sessions_by_document.len()
    }
}

fn create_file(directory: &tempfile::TempDir, name: &str) -> PathBuf {
    let path = directory.path().join(name);
    fs::write(&path, "").unwrap();
    path
}

#[test]
fn simultaneous_views_share_one_session_and_only_one_can_project() {
    let directory = tempfile::tempdir().unwrap();
    let path = create_file(&directory, "note.md");
    let registry = Arc::new(SharedDocumentRegistry::default());
    let barrier = Arc::new(Barrier::new(8));
    let handles: Vec<_> = (0..8)
        .map(|index| {
            let registry = Arc::clone(&registry);
            let barrier = Arc::clone(&barrier);
            let path = path.clone();
            thread::spawn(move || {
                barrier.wait();
                registry
                    .attach("doc-1", &path, &format!("window-{index}@1"))
                    .unwrap()
            })
        })
        .collect();
    let attachments: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();

    assert_eq!(registry.session_count(), 1);
    assert_eq!(
        attachments
            .iter()
            .filter(|attachment| registry.projection_permit(attachment).is_ok())
            .count(),
        1
    );
}

#[test]
fn competing_document_ids_for_one_canonical_path_have_exactly_one_winner() {
    let directory = tempfile::tempdir().unwrap();
    let path = create_file(&directory, "note.md");
    let alias = directory.path().join(".").join("note.md");
    let registry = Arc::new(SharedDocumentRegistry::default());
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = [("doc-1", path), ("doc-2", alias)]
        .into_iter()
        .map(|(document_id, path)| {
            let registry = Arc::clone(&registry);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                registry.attach(document_id, &path, document_id)
            })
        })
        .collect();
    let results: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();

    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(RegistryError::PathAlreadyOwned { .. })))
            .count(),
        1
    );
}

#[test]
fn rebind_fences_writes_without_invalidating_view_attachments() {
    let directory = tempfile::tempdir().unwrap();
    let old_path = create_file(&directory, "old.md");
    let new_path = create_file(&directory, "new.md");
    let registry = SharedDocumentRegistry::default();
    let owner = registry.attach("doc-1", &old_path, "window-1@1").unwrap();
    let view = registry.attach("doc-1", &old_path, "window-1@1").unwrap();
    let delayed_write = registry.projection_permit(&owner).unwrap();

    assert_eq!(
        registry.rebind_path(&view, &new_path),
        Err(RegistryError::NotProjectionOwner)
    );
    let current_write = registry.rebind_path(&owner, &new_path).unwrap();
    assert_eq!(
        registry.write_projection(&delayed_write, "stale"),
        Err(RegistryError::StaleGeneration)
    );
    registry
        .write_projection(&current_write, "current")
        .unwrap();
    registry.detach(&view).unwrap();
    assert_eq!(registry.session_count(), 1);
    registry.detach(&owner).unwrap();
    assert_eq!(registry.session_count(), 0);
    assert_eq!(fs::read_to_string(new_path).unwrap(), "current");
}

#[test]
fn validated_write_commits_before_concurrent_rebind_and_old_permit_stays_fenced() {
    let directory = tempfile::tempdir().unwrap();
    let old_path = create_file(&directory, "old.md");
    let new_path = create_file(&directory, "new.md");
    let registry = Arc::new(SharedDocumentRegistry::default());
    let owner = registry.attach("doc-1", &old_path, "window-1@1").unwrap();
    let old_permit = registry.projection_permit(&owner).unwrap();
    let validated = Arc::new(Barrier::new(2));
    let continue_write = Arc::new(Barrier::new(2));

    let writer = {
        let registry = Arc::clone(&registry);
        let validated = Arc::clone(&validated);
        let continue_write = Arc::clone(&continue_write);
        let permit = old_permit.clone();
        thread::spawn(move || {
            registry.write_projection_with_hook(&permit, "old commit", || {
                validated.wait();
                continue_write.wait();
            })
        })
    };
    validated.wait();
    let (sender, receiver) = mpsc::channel();
    let rebinder = {
        let registry = Arc::clone(&registry);
        let new_path = new_path.clone();
        let owner = owner.clone();
        thread::spawn(move || {
            let result = registry.rebind_path(&owner, &new_path);
            sender.send(result).unwrap();
        })
    };
    assert!(receiver.try_recv().is_err());
    continue_write.wait();
    writer.join().unwrap().unwrap();
    let current_permit = receiver.recv().unwrap().unwrap();
    rebinder.join().unwrap();

    assert_eq!(fs::read_to_string(&old_path).unwrap(), "old commit");
    assert_eq!(
        registry.write_projection(&old_permit, "late stale commit"),
        Err(RegistryError::StaleGeneration)
    );
    registry
        .write_projection(&current_permit, "new commit")
        .unwrap();
    assert_eq!(fs::read_to_string(new_path).unwrap(), "new commit");
}

#[test]
fn owner_handoff_and_window_cleanup_use_unique_attachment_incarnations() {
    let directory = tempfile::tempdir().unwrap();
    let path = create_file(&directory, "note.md");
    let registry = SharedDocumentRegistry::default();
    let first = registry.attach("doc-1", &path, "window-1@1").unwrap();
    let second = registry.attach("doc-1", &path, "window-1@1").unwrap();
    let survivor = registry.attach("doc-1", &path, "window-2@1").unwrap();
    let stale_write = registry.projection_permit(&first).unwrap();

    registry.detach(&first).unwrap();
    registry.detach(&first).unwrap();
    assert!(registry.projection_permit(&second).is_ok());
    thread::sleep(Duration::from_millis(5));
    registry
        .write_projection(&registry.projection_permit(&second).unwrap(), "after sleep")
        .unwrap();
    assert_eq!(
        registry.write_projection(&stale_write, "stale"),
        Err(RegistryError::StaleGeneration)
    );
    registry.release_window("window-1@1");
    let survivor_permit = registry.projection_permit(&survivor).unwrap();
    registry
        .write_projection(&survivor_permit, "survivor")
        .unwrap();
    registry.release_window("window-1@old");
    assert_eq!(registry.session_count(), 1);
    registry.release_window("window-2@1");
    assert_eq!(registry.session_count(), 0);

    let replacement = registry.attach("doc-1", &path, "window-3@1").unwrap();
    let replacement_permit = registry.projection_permit(&replacement).unwrap();
    assert!(replacement_permit.generation > survivor_permit.generation);
    assert_eq!(
        registry.write_projection(&survivor_permit, "released owner"),
        Err(RegistryError::StaleGeneration)
    );
    registry
        .write_projection(&replacement_permit, "replacement")
        .unwrap();
    assert_eq!(fs::read_to_string(path).unwrap(), "replacement");
}

#[test]
fn same_document_cannot_bind_two_paths_and_taken_rebind_is_atomic() {
    let directory = tempfile::tempdir().unwrap();
    let a = create_file(&directory, "a.md");
    let b = create_file(&directory, "b.md");
    let c = create_file(&directory, "c.md");
    let registry = SharedDocumentRegistry::default();
    let owner = registry.attach("doc-1", &a, "window-1@1").unwrap();
    registry.attach("doc-2", &b, "window-2@1").unwrap();

    assert!(matches!(
        registry.attach("doc-1", &b, "window-3@1"),
        Err(RegistryError::PathAlreadyOwned { .. })
    ));
    assert!(matches!(
        registry.attach("doc-1", &c, "window-3@1"),
        Err(RegistryError::DocumentAlreadyBound { .. })
    ));
    assert!(matches!(
        registry.rebind_path(&owner, &b),
        Err(RegistryError::PathAlreadyOwned { .. })
    ));
    assert_eq!(registry.session_count(), 2);
}
