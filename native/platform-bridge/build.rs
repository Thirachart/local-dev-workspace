fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() == "windows" {
        let mut res = winres::WindowsResource::new();
        res.set_icon("app.ico");
        res.set("FileDescription", "Local Dev Tool MCP - Native Control Panel");
        res.set("ProductName", "Local Dev Tool MCP");
        res.set("OriginalFilename", "LocalDevToolMCP.exe");
        if let Err(e) = res.compile() {
            eprintln!("Warning: failed to compile Windows resources: {}", e);
        }
    }
}
