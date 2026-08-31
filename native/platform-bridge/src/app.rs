use crate::icons::{ActionState, IconManager};
use std::ffi::OsStr;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    CreateSolidBrush, DeleteObject,
};
use windows_sys::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;
use windows_sys::Win32::UI::Shell::{
    SetCurrentProcessExplicitAppUserModelID, Shell_NotifyIconW,
    NIF_ICON, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE, NIM_MODIFY, NOTIFYICONDATAW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DestroyWindow,
    DispatchMessageW, GetCursorPos, GetMessageW, LoadCursorW, PostMessageW,
    PostQuitMessage, RegisterClassExW, SendMessageW, SetClassLongPtrW, SetForegroundWindow,
    ShowWindow, TrackPopupMenu, TranslateMessage, GCLP_HICON, GCLP_HICONSM, HICON, IDC_ARROW,
    MF_SEPARATOR, MF_STRING, SW_RESTORE, SW_SHOW, TPM_BOTTOMALIGN, TPM_LEFTALIGN,
    WM_CLOSE, WM_COMMAND, WM_CREATE, WM_DESTROY, WM_ERASEBKGND, WM_LBUTTONDBLCLK,
    WM_LBUTTONUP, WM_RBUTTONUP, WM_SETICON, WM_USER, WNDCLASSEXW,
    WS_EX_APPWINDOW, WS_OVERLAPPEDWINDOW,
};

const WM_TRAY_CALLBACK: u32 = WM_USER + 1;
const WM_UPDATE_STATUS: u32 = WM_USER + 2;

const ID_TRAY_OPEN_DASHBOARD: usize = 1001;
const ID_TRAY_OPEN_TUNNEL: usize = 1002;
const ID_TRAY_RESTART_SERVER: usize = 1003;
const ID_TRAY_QUIT: usize = 1004;

const CLSID_TASKBAR_LIST: [u8; 16] = [
    0x88, 0xea, 0x07, 0x56, 0x5a, 0xd0, 0x4c, 0x05, 0x80, 0x34, 0x0a, 0xa2, 0x6e, 0xb7, 0x4e, 0x28,
];
const IID_ITASKBAR_LIST3: [u8; 16] = [
    0x27, 0xb0, 0x28, 0xea, 0x87, 0x82, 0x4b, 0x0a, 0xbb, 0x37, 0x7c, 0x93, 0x48, 0x76, 0x48, 0x2b,
];

#[repr(C)]
struct ITaskbarList3Vtbl {
    pub query_interface: usize,
    pub add_ref: usize,
    pub release: usize,
    pub hr_init: unsafe extern "system" fn(this: *mut core::ffi::c_void) -> i32,
    pub add_tab: usize,
    pub delete_tab: usize,
    pub activate_tab: usize,
    pub set_active_alt: usize,
    pub mark_fullscreen_window: usize,
    pub set_progress_value: usize,
    pub set_progress_state: unsafe extern "system" fn(this: *mut core::ffi::c_void, hwnd: HWND, flags: u32) -> i32,
    pub register_tab: usize,
    pub unregister_tab: usize,
    pub set_tab_order: usize,
    pub set_tab_active: usize,
    pub thumb_bar_add_buttons: usize,
    pub thumb_bar_update_buttons: usize,
    pub thumb_bar_set_image_list: usize,
    pub set_overlay_icon: unsafe extern "system" fn(this: *mut core::ffi::c_void, hwnd: HWND, hicon: HICON, psz_description: *const u16) -> i32,
}

fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

pub struct WindowsApp {
    hwnd: HWND,
    icons: IconManager,
    current_state: ActionState,
    current_label: String,
    taskbar_ptr: *mut core::ffi::c_void,
    port: u16,
}

static mut APP_INSTANCE: *mut WindowsApp = ptr::null_mut();

pub fn run_app(port: u16) {
    unsafe {
        SetCurrentProcessExplicitAppUserModelID(to_wide("Thirachart.LocalDevToolMCP.App").as_ptr());
        CoInitializeEx(ptr::null(), COINIT_APARTMENTTHREADED as u32);
    }

    let icons = IconManager::new();
    let class_name = to_wide("LocalDevToolMCPSupervisorClass");
    let window_title = to_wide("Local Dev Tool MCP");

    unsafe {
        let hinstance = GetModuleHandleW(ptr::null());
        let bg_brush = CreateSolidBrush(0x00F9F5F1);
        let wnd_class = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: 0,
            lpfnWndProc: Some(wnd_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinstance,
            hIcon: icons.idle,
            hCursor: LoadCursorW(ptr::null_mut(), IDC_ARROW),
            hbrBackground: bg_brush,
            lpszMenuName: ptr::null(),
            lpszClassName: class_name.as_ptr(),
            hIconSm: icons.idle,
        };

        RegisterClassExW(&wnd_class);

        let hwnd = CreateWindowExW(
            WS_EX_APPWINDOW,
            class_name.as_ptr(),
            window_title.as_ptr(),
            WS_OVERLAPPEDWINDOW,
            -32000,
            -32000,
            1,
            1,
            ptr::null_mut(),
            ptr::null_mut(),
            hinstance,
            ptr::null(),
        );

        let mut taskbar_ptr: *mut core::ffi::c_void = ptr::null_mut();
        let hr = CoCreateInstance(
            CLSID_TASKBAR_LIST.as_ptr() as _,
            ptr::null_mut(),
            CLSCTX_INPROC_SERVER,
            IID_ITASKBAR_LIST3.as_ptr() as _,
            &mut taskbar_ptr,
        );

        if hr >= 0 && !taskbar_ptr.is_null() {
            let vtbl = *(taskbar_ptr as *mut *const ITaskbarList3Vtbl);
            ((*vtbl).hr_init)(taskbar_ptr);
        }

        let mut app = WindowsApp {
            hwnd,
            icons,
            current_state: ActionState::Idle,
            current_label: "Standby & Ready for AI Instructions".to_string(),
            taskbar_ptr,
            port,
        };

        APP_INSTANCE = &mut app as *mut WindowsApp;

        // Initialize System Tray Icon
        app.init_tray();
        app.update_status(ActionState::Idle, "Standby & Ready for AI Instructions");

        // Ensure backend server is started
        ensure_node_server(port);

        // Wait for server health check
        for _ in 0..20 {
            if check_http_healthy(port) {
                break;
            }
            thread::sleep(Duration::from_millis(150));
        }

        // Launch Dashboard directly as the Standalone Native App Window
        let app_child = open_standalone_app_window(port);

        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();
        let hwnd_raw = hwnd as usize;

        thread::spawn(move || {
            status_poller_thread_fast(hwnd_raw, port, running_clone);
        });

        // Watchdog thread: when user closes dashboard window or requests quit
        let running_watchdog = running.clone();
        let hwnd_for_exit = hwnd as usize;
        thread::spawn(move || {
            if let Some(mut child) = app_child {
                let _ = child.wait();
                running_watchdog.store(false, Ordering::SeqCst);
                PostMessageW(hwnd_for_exit as HWND, WM_CLOSE, 0, 0);
            }
        });

        let mut msg = std::mem::zeroed();
        while GetMessageW(&mut msg, ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        running.store(false, Ordering::SeqCst);
        app.remove_tray();
        kill_node_server(port);
        DeleteObject(bg_brush as _);
        CoUninitialize();
    }
}

impl WindowsApp {
    fn init_tray(&self) {
        unsafe {
            let nid = self.create_notify_data(self.icons.idle, "Local Dev Tool MCP - Initializing");
            Shell_NotifyIconW(NIM_ADD, &nid);
        }
    }

    fn remove_tray(&self) {
        unsafe {
            let mut nid: NOTIFYICONDATAW = std::mem::zeroed();
            nid.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
            nid.hWnd = self.hwnd;
            nid.uID = 1;
            Shell_NotifyIconW(NIM_DELETE, &nid);
        }
    }

    fn create_notify_data(&self, icon: HICON, tip_str: &str) -> NOTIFYICONDATAW {
        let mut nid: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
        nid.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
        nid.hWnd = self.hwnd;
        nid.uID = 1;
        nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
        nid.uCallbackMessage = WM_TRAY_CALLBACK;
        nid.hIcon = icon;

        let wide_tip = to_wide(tip_str);
        let copy_len = wide_tip.len().min(127);
        nid.szTip[..copy_len].copy_from_slice(&wide_tip[..copy_len]);

        nid
    }

    fn update_status(&mut self, state: ActionState, custom_text: &str) {
        self.current_state = state;
        self.current_label = custom_text.to_string();
        let hicon = self.icons.get(state);

        unsafe {
            SendMessageW(self.hwnd, WM_SETICON, 1, hicon as LPARAM);
            SendMessageW(self.hwnd, WM_SETICON, 0, hicon as LPARAM);
            SetClassLongPtrW(self.hwnd, GCLP_HICON, hicon as isize);
            SetClassLongPtrW(self.hwnd, GCLP_HICONSM, hicon as isize);

            let tip = format!("Local Dev Tool MCP ({})\n{}", self.port, custom_text);
            let nid = self.create_notify_data(hicon, &tip);
            Shell_NotifyIconW(NIM_MODIFY, &nid);

            if !self.taskbar_ptr.is_null() {
                let vtbl = *(self.taskbar_ptr as *mut *const ITaskbarList3Vtbl);
                let desc = to_wide(custom_text);
                ((*vtbl).set_overlay_icon)(self.taskbar_ptr, self.hwnd, hicon, desc.as_ptr());

                let progress_flag = if state != ActionState::Idle { 0x1 } else { 0x0 };
                ((*vtbl).set_progress_state)(self.taskbar_ptr, self.hwnd, progress_flag);
            }
        }
    }

    fn show_tray_menu(&self) {
        unsafe {
            let hmenu = CreatePopupMenu();
            let label_dash = to_wide(&format!("๐ Open Web Dashboard (Port {})", self.port));
            let label_tunnel = to_wide("๐” Open OpenAI Tunnel UI (Port 8080)");
            let label_restart = to_wide("๐” Restart MCP Server Process");
            let label_quit = to_wide("๐‘ Stop & Quit All Services");

            AppendMenuW(hmenu, MF_STRING, ID_TRAY_OPEN_DASHBOARD, label_dash.as_ptr());
            AppendMenuW(hmenu, MF_STRING, ID_TRAY_OPEN_TUNNEL, label_tunnel.as_ptr());
            AppendMenuW(hmenu, MF_SEPARATOR, 0, ptr::null());
            AppendMenuW(hmenu, MF_STRING, ID_TRAY_RESTART_SERVER, label_restart.as_ptr());
            AppendMenuW(hmenu, MF_SEPARATOR, 0, ptr::null());
            AppendMenuW(hmenu, MF_STRING, ID_TRAY_QUIT, label_quit.as_ptr());

            let mut pt: POINT = std::mem::zeroed();
            GetCursorPos(&mut pt);

            SetForegroundWindow(self.hwnd);
            TrackPopupMenu(hmenu, TPM_BOTTOMALIGN | TPM_LEFTALIGN, pt.x, pt.y, 0, self.hwnd, ptr::null());
            DestroyMenu(hmenu);
        }
    }
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_CREATE => 0,
        WM_ERASEBKGND => 1,
        WM_TRAY_CALLBACK => {
            match lparam as u32 {
                WM_RBUTTONUP => {
                    if !APP_INSTANCE.is_null() {
                        (*APP_INSTANCE).show_tray_menu();
                    }
                }
                WM_LBUTTONUP | WM_LBUTTONDBLCLK => {
                    if !APP_INSTANCE.is_null() {
                        open_standalone_app_window((*APP_INSTANCE).port);
                    }
                }
                _ => {}
            }
            0
        }
        WM_COMMAND => {
            let id = (wparam & 0xFFFF) as usize;
            if !APP_INSTANCE.is_null() {
                let app = &mut *APP_INSTANCE;
                match id {
                    ID_TRAY_OPEN_DASHBOARD => {
                        open_standalone_app_window(app.port);
                    }
                    ID_TRAY_OPEN_TUNNEL => {
                        open_url("http://127.0.0.1:8080/ui");
                    }
                    ID_TRAY_RESTART_SERVER => {
                        restart_node_server(app.port);
                    }
                    ID_TRAY_QUIT => {
                        PostMessageW(hwnd, WM_CLOSE, 0, 0);
                    }
                    _ => {}
                }
            }
            0
        }
        WM_UPDATE_STATUS => {
            if !APP_INSTANCE.is_null() {
                let state_code = wparam as u32;
                let state = match state_code {
                    1 => ActionState::Read,
                    2 => ActionState::Write,
                    3 => ActionState::Terminal,
                    4 => ActionState::Test,
                    5 => ActionState::Git,
                    6 => ActionState::Error,
                    _ => ActionState::Idle,
                };
                (*APP_INSTANCE).update_status(state, state.tooltip_label());
            }
            0
        }
        WM_CLOSE => {
            DestroyWindow(hwnd);
            0
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn open_url(url: &str) {
    let _ = Command::new("cmd")
        .args(["/c", "start", url])
        .spawn();
}

fn open_standalone_app_window(port: u16) -> Option<std::process::Child> {
    let url = format!("http://127.0.0.1:{}/logs", port);
    let edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ];

    let mut edge_exe = "msedge";
    for p in &edge_paths {
        if std::path::Path::new(p).exists() {
            edge_exe = p;
            break;
        }
    }

    let user_data = format!(
        r"--user-data-dir={}\LocalDevToolMCP\webview_profile",
        std::env::var("LOCALAPPDATA").unwrap_or_else(|_| r"C:\Users\Default\AppData\Local".to_string())
    );

    Command::new(edge_exe)
        .args([
            &format!("--app={}", url),
            "--window-size=1160,800",
            &user_data,
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-features=TranslateUI,SidePanel,OptimizationHints",
        ])
        .spawn()
        .ok()
}

fn ensure_node_server(port: u16) {
    if check_http_healthy(port) {
        return;
    }

    let _ = Command::new("node")
        .args(["dist/index.js", "--sse", "--port", &port.to_string()])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

fn restart_node_server(port: u16) {
    kill_node_server(port);
    thread::sleep(Duration::from_millis(500));
    ensure_node_server(port);
}

fn kill_node_server(port: u16) {
    let _ = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "Get-NetTCPConnection -LocalPort {} -ErrorAction SilentlyContinue | ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }}; Get-Process -Name 'tunnel-client' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue",
                port
            ),
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

fn check_http_healthy(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(200)) {
        let _ = stream.set_write_timeout(Some(Duration::from_millis(200)));
        let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
        let req = format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n", port);
        if stream.write_all(req.as_bytes()).is_ok() {
            let mut buf = [0u8; 128];
            if let Ok(n) = stream.read(&mut buf) {
                let s = String::from_utf8_lossy(&buf[..n]);
                return s.contains("200 OK");
            }
        }
    }
    false
}

fn status_poller_thread_fast(hwnd_raw: usize, port: u16, running: Arc<AtomicBool>) {
    let mut last_state = ActionState::Idle;

    while running.load(Ordering::Relaxed) {
        thread::sleep(Duration::from_millis(150));

        if let Some(state) = fetch_agent_state_fast(port) {
            if state != last_state {
                last_state = state;
                let code = match state {
                    ActionState::Idle => 0,
                    ActionState::Read => 1,
                    ActionState::Write => 2,
                    ActionState::Terminal => 3,
                    ActionState::Test => 4,
                    ActionState::Git => 5,
                    ActionState::Error => 6,
                };
                unsafe {
                    PostMessageW(hwnd_raw as HWND, WM_UPDATE_STATUS, code as WPARAM, 0);
                }
            }
        }
    }
}

fn fetch_agent_state_fast(port: u16) -> Option<ActionState> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(150)).ok()?;
    let _ = stream.set_write_timeout(Some(Duration::from_millis(150)));
    let _ = stream.set_read_timeout(Some(Duration::from_millis(150)));

    let req = format!(
        "GET /api/ui/agent_status HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        port
    );
    stream.write_all(req.as_bytes()).ok()?;

    let mut buf = Vec::with_capacity(2048);
    let _ = stream.read_to_end(&mut buf);
    let response = String::from_utf8_lossy(&buf);

    if let Some(idx) = response.find("\"activeAction\":\"") {
        let start = idx + 16;
        if let Some(end) = response[start..].find('"') {
            let action_str = &response[start..start + end];
            return Some(ActionState::from_str(action_str));
        }
    }

    Some(ActionState::Idle)
}
