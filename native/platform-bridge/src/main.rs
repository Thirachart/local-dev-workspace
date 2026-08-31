#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;

mod icons;
#[cfg(windows)]
mod app;

#[cfg(windows)]
mod windows_bridge {
    use std::ffi::OsStr;
    use std::fs;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr;

    #[link(name = "Kernel32")]
    extern "system" {
        fn ReplaceFileW(
            lpReplacedFileName: *const u16,
            lpReplacementFileName: *const u16,
            lpBackupFileName: *const u16,
            dwReplaceFlags: u32,
            lpExclude: *mut core::ffi::c_void,
            lpReserved: *mut core::ffi::c_void,
        ) -> i32;
        fn MoveFileExW(
            lpExistingFileName: *const u16,
            lpNewFileName: *const u16,
            dwFlags: u32,
        ) -> i32;
        fn GetLastError() -> u32;
    }

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x00000001;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x00000008;
    const ERROR_SHARING_VIOLATION: u32 = 32;
    const ERROR_LOCK_VIOLATION: u32 = 33;
    const ERROR_NOT_SAME_DEVICE: u32 = 17;
    const ERROR_ACCESS_DENIED: u32 = 5;

    fn wide(path: &str) -> Vec<u16> {
        OsStr::new(path).encode_wide().chain(Some(0)).collect()
    }

    fn code_name(code: u32) -> &'static str {
        match code {
            ERROR_SHARING_VIOLATION => "ERROR_SHARING_VIOLATION",
            ERROR_LOCK_VIOLATION => "ERROR_LOCK_VIOLATION",
            ERROR_NOT_SAME_DEVICE => "ERROR_NOT_SAME_DEVICE",
            ERROR_ACCESS_DENIED => "ERROR_ACCESS_DENIED",
            _ => "WIN32_ERROR",
        }
    }

    fn emit(ok: bool, code: Option<&str>, message: &str, provider: &str) {
        let escaped = message.replace('\\', "\\\\").replace('"', "\\\"");
        match code {
            Some(code) => println!(
                "{{\"ok\":{},\"code\":\"{}\",\"message\":\"{}\",\"provider\":\"{}\"}}",
                ok, code, escaped, provider
            ),
            None => println!(
                "{{\"ok\":{},\"message\":\"{}\",\"provider\":\"{}\"}}",
                ok, escaped, provider
            ),
        }
    }

    pub fn probe() -> i32 {
        emit(true, None, "ReplaceFileW bridge available", "replace-file-w");
        0
    }

    pub fn replace(source: &str, target: &str) -> i32 {
        let source_parent = Path::new(source).parent();
        let target_parent = Path::new(target).parent();
        if source_parent != target_parent {
            emit(
                false,
                Some("ATOMIC_REPLACE_UNAVAILABLE"),
                "source and target must share the same directory",
                "replace-file-w",
            );
            return 2;
        }

        let source_w = wide(source);
        let target_w = wide(target);
        let target_exists = fs::metadata(target).is_ok();

        let result = unsafe {
            if target_exists {
                ReplaceFileW(
                    target_w.as_ptr(),
                    source_w.as_ptr(),
                    ptr::null(),
                    0,
                    ptr::null_mut(),
                    ptr::null_mut(),
                )
            } else {
                MoveFileExW(
                    source_w.as_ptr(),
                    target_w.as_ptr(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            }
        };

        if result != 0 {
            emit(
                true,
                None,
                if target_exists { "file replaced" } else { "file installed" },
                if target_exists { "replace-file-w" } else { "move-file-ex-w" },
            );
            return 0;
        }

        let error = unsafe { GetLastError() };
        emit(
            false,
            Some(code_name(error)),
            &format!("Win32 replacement failed with error {}", error),
            if target_exists { "replace-file-w" } else { "move-file-ex-w" },
        );
        1
    }
}

#[cfg(not(windows))]
mod windows_bridge {
    pub fn probe() -> i32 {
        println!("{}", r#"{"ok":false,"code":"UNSUPPORTED_PLATFORM","message":"native Windows bridge requires win32","provider":"unavailable"}"#);
        2
    }

    pub fn replace(_source: &str, _target: &str) -> i32 {
        println!("{}", r#"{"ok":false,"code":"UNSUPPORTED_PLATFORM","message":"native Windows bridge requires win32","provider":"unavailable"}"#);
        2
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let port = env::var("PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(4100);

    let first_arg = args.get(1).map(String::as_str);

    match first_arg {
        Some("probe") => {
            let code = windows_bridge::probe();
            std::process::exit(code);
        }
        Some("replace") if args.len() == 4 => {
            let code = windows_bridge::replace(&args[2], &args[3]);
            std::process::exit(code);
        }
        Some("--gui") | Some("gui") | None => {
            #[cfg(windows)]
            {
                app::run_app(port);
            }
            #[cfg(not(windows))]
            {
                println!("Native Windows GUI is only supported on Windows.");
            }
        }
        _ => {
            println!(
                "{}",
                r#"Local Dev Tool MCP Native Windows Bridge
Usage:
  chat-dev-platform-bridge (launches native Taskbar & System Tray app)
  chat-dev-platform-bridge probe
  chat-dev-platform-bridge replace <source> <target>"#
            );
            std::process::exit(0);
        }
    }
}
