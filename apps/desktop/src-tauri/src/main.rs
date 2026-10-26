// Prevent Windows from opening a separate console window for Dayset.
#![windows_subsystem = "windows"]

fn main() {
    dayset_lib::run();
}
