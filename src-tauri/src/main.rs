// Desktop previews must not open a console window either.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    lifeos_lib::run()
}
