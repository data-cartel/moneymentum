use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use thiserror::Error;

const DIAGNOSTICS_DIRECTORY: &str = ".local/state/moneymentum";
const DIAGNOSTICS_FILE: &str = "operator-diagnostics.log";
const REDACTED_RECORD: &[u8] = b"runtime output redacted before persistence\n";

#[derive(Debug, Error)]
enum DiagnosticsError {
    #[error("HOME is required to locate the operator diagnostics log")]
    HomeMissing,
    #[error("HOME must be an absolute, non-empty path")]
    HomeInvalid,
    #[error("diagnostics path has no parent directory")]
    PathMissingParent,
    #[error("diagnostics directory is not a real directory")]
    DirectoryNotReal,
    #[error("diagnostics file is not a regular file")]
    FileNotRegular,
    #[error("diagnostics file changed while opening")]
    FileChangedWhileOpening,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

fn main() -> Result<(), DiagnosticsError> {
    let diagnostics_path = diagnostics_path()?;
    persist_redacted_records(std::io::stdin().lock(), &diagnostics_path)
}

fn diagnostics_path() -> Result<PathBuf, DiagnosticsError> {
    let home = std::env::var_os("HOME").ok_or(DiagnosticsError::HomeMissing)?;
    diagnostics_path_from_home(&home)
}

fn diagnostics_path_from_home(home: &std::ffi::OsStr) -> Result<PathBuf, DiagnosticsError> {
    let home = PathBuf::from(home);
    if !home.is_absolute() {
        return Err(DiagnosticsError::HomeInvalid);
    }

    Ok(home.join(DIAGNOSTICS_DIRECTORY).join(DIAGNOSTICS_FILE))
}

fn persist_redacted_records(
    mut runtime_output: impl Read,
    diagnostics_path: &Path,
) -> Result<(), DiagnosticsError> {
    let mut buffer = [0_u8; 8 * 1024];
    let mut received_output = false;

    loop {
        let bytes_read = runtime_output.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        received_output = true;
    }
    if !received_output {
        return Ok(());
    }

    let parent = diagnostics_path
        .parent()
        .ok_or(DiagnosticsError::PathMissingParent)?;
    std::fs::create_dir_all(parent)?;
    let parent_metadata = std::fs::symlink_metadata(parent)?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err(DiagnosticsError::DirectoryNotReal);
    }
    #[cfg(unix)]
    std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;

    match std::fs::symlink_metadata(diagnostics_path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(DiagnosticsError::FileNotRegular);
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }

    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut diagnostics_file = options.open(diagnostics_path)?;
    let opened_metadata = diagnostics_file.metadata()?;
    let path_metadata = std::fs::symlink_metadata(diagnostics_path)?;
    if path_metadata.file_type().is_symlink() || !path_metadata.is_file() {
        return Err(DiagnosticsError::FileNotRegular);
    }
    #[cfg(unix)]
    if opened_metadata.dev() != path_metadata.dev() || opened_metadata.ino() != path_metadata.ino()
    {
        return Err(DiagnosticsError::FileChangedWhileOpening);
    }
    #[cfg(unix)]
    diagnostics_file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    diagnostics_file.write_all(REDACTED_RECORD)?;
    diagnostics_file.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io;

    use super::*;

    #[test]
    fn writer_persists_no_runtime_bytes_including_invalid_utf8() {
        let temporary_directory = tempfile::tempdir().unwrap();
        let diagnostics_path = temporary_directory.path().join("operator-diagnostics.log");
        let runtime_output = b"token=do-not-persist\xff\xfe\n";

        persist_redacted_records(runtime_output.as_slice(), &diagnostics_path).unwrap();

        let persisted = std::fs::read(&diagnostics_path).unwrap();
        assert_eq!(persisted, REDACTED_RECORD);
        assert!(!persisted.windows(5).any(|window| window == b"token"));
        assert!(!persisted.contains(&0xff));
        assert!(!persisted.contains(&0xfe));
    }

    #[cfg(unix)]
    #[test]
    fn writer_restricts_diagnostics_permissions() {
        let temporary_directory = tempfile::tempdir().unwrap();
        let diagnostics_path = temporary_directory
            .path()
            .join("state/operator-diagnostics.log");

        persist_redacted_records(b"sensitive\n".as_slice(), &diagnostics_path).unwrap();

        let directory_mode = std::fs::metadata(diagnostics_path.parent().unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        let file_mode = std::fs::metadata(&diagnostics_path)
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(directory_mode, 0o700);
        assert_eq!(file_mode, 0o600);
    }

    #[test]
    fn fragmented_input_persists_one_fixed_record() {
        let temporary_directory = tempfile::tempdir().unwrap();
        let diagnostics_path = temporary_directory.path().join("operator-diagnostics.log");

        persist_redacted_records(OneByteReader::new(b"four bytes"), &diagnostics_path).unwrap();

        assert_eq!(std::fs::read(diagnostics_path).unwrap(), REDACTED_RECORD);
    }

    #[test]
    fn empty_or_relative_home_is_rejected() {
        for home in [
            std::ffi::OsStr::new(""),
            std::ffi::OsStr::new("relative-home"),
        ] {
            assert!(matches!(
                diagnostics_path_from_home(home),
                Err(DiagnosticsError::HomeInvalid)
            ));
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_log_is_rejected_without_modifying_its_target() {
        use std::os::unix::fs::symlink;

        let temporary_directory = tempfile::tempdir().unwrap();
        let target_path = temporary_directory.path().join("target.log");
        let diagnostics_path = temporary_directory.path().join("operator-diagnostics.log");
        std::fs::write(&target_path, b"preserve me").unwrap();
        symlink(&target_path, &diagnostics_path).unwrap();

        let result = persist_redacted_records(b"sensitive\n".as_slice(), &diagnostics_path);

        assert!(matches!(result, Err(DiagnosticsError::FileNotRegular)));
        assert_eq!(std::fs::read(target_path).unwrap(), b"preserve me");
    }

    #[test]
    fn reader_failure_creates_no_persistent_output() {
        let temporary_directory = tempfile::tempdir().unwrap();
        let diagnostics_path = temporary_directory.path().join("operator-diagnostics.log");

        let result = persist_redacted_records(FailingReader, &diagnostics_path);

        assert!(matches!(result, Err(DiagnosticsError::Io(_))));
        assert!(!diagnostics_path.exists());
    }

    struct OneByteReader<'a> {
        remaining: &'a [u8],
    }

    impl<'a> OneByteReader<'a> {
        const fn new(remaining: &'a [u8]) -> Self {
            Self { remaining }
        }
    }

    impl Read for OneByteReader<'_> {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            let Some((next, remaining)) = self.remaining.split_first() else {
                return Ok(0);
            };
            buffer[0] = *next;
            self.remaining = remaining;
            Ok(1)
        }
    }

    struct FailingReader;

    impl Read for FailingReader {
        fn read(&mut self, _buffer: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::other("injected read failure"))
        }
    }
}
