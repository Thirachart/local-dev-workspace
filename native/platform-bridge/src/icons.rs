use windows_sys::Win32::Graphics::Gdi::{
    CreateBitmap, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateIconIndirect, DestroyIcon, HICON, ICONINFO,
};
use std::ptr;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionState {
    Idle,
    Read,
    Write,
    Terminal,
    Test,
    Git,
    Error,
}

impl ActionState {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "read" | "read_file" | "grep_search" | "find_by_name" | "symbol_index" | "list_directory" | "get_file_info" => ActionState::Read,
            "write" | "write_file" | "edit_file" | "apply_patch" | "delete_file" | "write_handoff" => ActionState::Write,
            "terminal" | "command" | "build" | "run_command" | "process_manager" => ActionState::Terminal,
            "test" | "run_tests" | "run_diagnostics" | "parse_diagnostics" | "suggest_tests" => ActionState::Test,
            "git" | "git_status" | "git_diff" | "git_log" | "git_commit" | "git_branch" | "git_push" => ActionState::Git,
            "error" | "blocked" => ActionState::Error,
            _ => ActionState::Idle,
        }
    }

    pub fn tooltip_label(&self) -> &'static str {
        match self {
            ActionState::Idle => "Standby & Ready",
            ActionState::Read => "Reading / Searching Code",
            ActionState::Write => "Writing / Modifying Files",
            ActionState::Terminal => "Executing Shell Command",
            ActionState::Test => "Running Diagnostics / Tests",
            ActionState::Git => "Git Version Control Operations",
            ActionState::Error => "Action Error / Blocked",
        }
    }

    pub fn emoji(&self) -> &'static str {
        match self {
            ActionState::Idle => "🟢",
            ActionState::Read => "🔵",
            ActionState::Write => "🟡",
            ActionState::Terminal => "🟠",
            ActionState::Test => "🟣",
            ActionState::Git => "🌿",
            ActionState::Error => "🔴",
        }
    }
}

pub struct IconManager {
    pub idle: HICON,
    pub read: HICON,
    pub write: HICON,
    pub terminal: HICON,
    pub test: HICON,
    pub git: HICON,
    pub error: HICON,
}

impl IconManager {
    pub fn new() -> Self {
        Self {
            idle: create_state_icon(ActionState::Idle),
            read: create_state_icon(ActionState::Read),
            write: create_state_icon(ActionState::Write),
            terminal: create_state_icon(ActionState::Terminal),
            test: create_state_icon(ActionState::Test),
            git: create_state_icon(ActionState::Git),
            error: create_state_icon(ActionState::Error),
        }
    }

    pub fn get(&self, state: ActionState) -> HICON {
        match state {
            ActionState::Idle => self.idle,
            ActionState::Read => self.read,
            ActionState::Write => self.write,
            ActionState::Terminal => self.terminal,
            ActionState::Test => self.test,
            ActionState::Git => self.git,
            ActionState::Error => self.error,
        }
    }
}

impl Drop for IconManager {
    fn drop(&mut self) {
        unsafe {
            if !self.idle.is_null() { DestroyIcon(self.idle); }
            if !self.read.is_null() { DestroyIcon(self.read); }
            if !self.write.is_null() { DestroyIcon(self.write); }
            if !self.terminal.is_null() { DestroyIcon(self.terminal); }
            if !self.test.is_null() { DestroyIcon(self.test); }
            if !self.git.is_null() { DestroyIcon(self.git); }
            if !self.error.is_null() { DestroyIcon(self.error); }
        }
    }
}

fn create_state_icon(state: ActionState) -> HICON {
    const SIZE: usize = 32;
    let mut pixels = [0u32; SIZE * SIZE];

    let (primary_color, ring_color) = match state {
        ActionState::Idle => (0xFF10B981, 0xFF059669),
        ActionState::Read => (0xFF3B82F6, 0xFF1D4ED8),
        ActionState::Write => (0xFFF59E0B, 0xFFD97706),
        ActionState::Terminal => (0xFFF97316, 0xFFEA580C),
        ActionState::Test => (0xFF8B5CF6, 0xFF6D28D9),
        ActionState::Git => (0xFF14B8A6, 0xFF0D9488),
        ActionState::Error => (0xFFEF4444, 0xFFDC2626),
    };

    let cx = (SIZE as f32) / 2.0;
    let cy = (SIZE as f32) / 2.0;
    let outer_radius = 14.5f32;
    let inner_radius = 11.5f32;

    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = (x as f32) + 0.5 - cx;
            let dy = (y as f32) + 0.5 - cy;
            let dist = (dx * dx + dy * dy).sqrt();

            let idx = (SIZE - 1 - y) * SIZE + x;

            if dist <= inner_radius {
                pixels[idx] = primary_color;
            } else if dist <= outer_radius {
                let edge_alpha = ((outer_radius - dist) / 1.0).clamp(0.0, 1.0);
                let alpha = (255.0 * edge_alpha) as u32;
                pixels[idx] = (alpha << 24) | (ring_color & 0x00FFFFFF);
            } else if dist <= outer_radius + 1.0 {
                let edge_alpha = ((outer_radius + 1.0 - dist) / 1.0).clamp(0.0, 1.0);
                let alpha = (120.0 * edge_alpha) as u32;
                pixels[idx] = (alpha << 24) | (ring_color & 0x00FFFFFF);
            }
        }
    }

    match state {
        ActionState::Read => {
            draw_rect(&mut pixels, SIZE, 10, 10, 12, 12, 0xFFFFFFFF);
            draw_rect(&mut pixels, SIZE, 12, 12, 8, 8, primary_color);
            draw_line(&mut pixels, SIZE, 18, 18, 22, 22, 0xFFFFFFFF);
        }
        ActionState::Write => {
            draw_line(&mut pixels, SIZE, 10, 21, 21, 10, 0xFFFFFFFF);
            draw_line(&mut pixels, SIZE, 11, 22, 22, 11, 0xFFFFFFFF);
        }
        ActionState::Terminal => {
            draw_line(&mut pixels, SIZE, 10, 11, 15, 16, 0xFFFFFFFF);
            draw_line(&mut pixels, SIZE, 10, 21, 15, 16, 0xFFFFFFFF);
            draw_line(&mut pixels, SIZE, 16, 21, 21, 21, 0xFFFFFFFF);
        }
        ActionState::Test => {
            draw_line(&mut pixels, SIZE, 13, 10, 19, 10, 0xFFFFFFFF);
            draw_line(&mut pixels, SIZE, 14, 11, 14, 15, 0xFFFFFFFF);
            draw_line(&mut pixels, SIZE, 18, 11, 18, 15, 0xFFFFFFFF);
            draw_line(&mut pixels, SIZE, 10, 22, 22, 22, 0xFFFFFFFF);
            draw_line(&mut pixels, SIZE, 14, 15, 10, 22, 0xFFFFFFFF);
            draw_line(&mut pixels, SIZE, 18, 15, 22, 22, 0xFFFFFFFF);
        }
        ActionState::Git => {
            draw_line(&mut pixels, SIZE, 12, 10, 12, 22, 0xFFFFFFFF);
            draw_line(&mut pixels, SIZE, 12, 16, 20, 12, 0xFFFFFFFF);
            draw_rect(&mut pixels, SIZE, 10, 10, 5, 5, 0xFFFFFFFF);
            draw_rect(&mut pixels, SIZE, 10, 20, 5, 5, 0xFFFFFFFF);
            draw_rect(&mut pixels, SIZE, 18, 10, 5, 5, 0xFFFFFFFF);
        }
        ActionState::Error => {
            draw_line(&mut pixels, SIZE, 15, 10, 15, 18, 0xFFFFFFFF);
            draw_line(&mut pixels, SIZE, 16, 10, 16, 18, 0xFFFFFFFF);
            draw_rect(&mut pixels, SIZE, 15, 20, 2, 2, 0xFFFFFFFF);
        }
        ActionState::Idle => {
            draw_circle(&mut pixels, SIZE, 16.0, 16.0, 4.0, 0xFFFFFFFF);
        }
    }

    create_hicon_from_argb(&pixels, SIZE, SIZE)
}

fn draw_rect(pixels: &mut [u32], size: usize, x: usize, y: usize, w: usize, h: usize, color: u32) {
    for cy in y..(y + h).min(size) {
        for cx in x..(x + w).min(size) {
            let idx = (size - 1 - cy) * size + cx;
            pixels[idx] = color;
        }
    }
}

fn draw_line(pixels: &mut [u32], size: usize, x0: usize, y0: usize, x1: usize, y1: usize, color: u32) {
    let dx = (x1 as isize - x0 as isize).abs();
    let dy = -(y1 as isize - y0 as isize).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx + dy;
    let mut cx = x0 as isize;
    let mut cy = y0 as isize;

    loop {
        if cx >= 0 && cx < size as isize && cy >= 0 && cy < size as isize {
            let idx = (size - 1 - cy as usize) * size + cx as usize;
            pixels[idx] = color;
        }
        if cx == x1 as isize && cy == y1 as isize { break; }
        let e2 = 2 * err;
        if e2 >= dy { err += dy; cx += sx; }
        if e2 <= dx { err += dx; cy += sy; }
    }
}

fn draw_circle(pixels: &mut [u32], size: usize, cx: f32, cy: f32, radius: f32, color: u32) {
    let r2 = radius * radius;
    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            if dx * dx + dy * dy <= r2 {
                let idx = (size - 1 - y) * size + x;
                pixels[idx] = color;
            }
        }
    }
}

fn create_hicon_from_argb(pixels: &[u32], width: usize, height: usize) -> HICON {
    unsafe {
        let hdc = CreateCompatibleDC(ptr::null_mut());
        if hdc.is_null() { return ptr::null_mut(); }

        let mut bi: BITMAPINFO = std::mem::zeroed();
        bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bi.bmiHeader.biWidth = width as i32;
        bi.bmiHeader.biHeight = height as i32;
        bi.bmiHeader.biPlanes = 1;
        bi.bmiHeader.biBitCount = 32;
        bi.bmiHeader.biCompression = BI_RGB;

        let mut bits_ptr: *mut core::ffi::c_void = ptr::null_mut();
        let hbm_color = CreateDIBSection(
            hdc,
            &bi,
            DIB_RGB_COLORS,
            &mut bits_ptr,
            ptr::null_mut(),
            0,
        );

        if hbm_color.is_null() || bits_ptr.is_null() {
            DeleteDC(hdc);
            return ptr::null_mut();
        }

        std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits_ptr as *mut u32, pixels.len());

        let hbm_mask = CreateBitmap(width as i32, height as i32, 1, 1, ptr::null());

        let mut icon_info = ICONINFO {
            fIcon: 1,
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: hbm_mask,
            hbmColor: hbm_color,
        };

        let hicon = CreateIconIndirect(&mut icon_info);

        DeleteObject(hbm_color as _);
        DeleteObject(hbm_mask as _);
        DeleteDC(hdc);

        hicon
    }
}
