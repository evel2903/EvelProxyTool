//! Agent client discovery, configuration generation, and reversible state management.

use super::*;

mod commands;
mod antigravity_bridge;
mod antigravity_desktop;
mod configuration;
mod discovery;
mod launch;
mod state;
pub(crate) use commands::*;
pub(crate) use antigravity_desktop::{antigravity_desktop_version_supported, get_antigravity_desktop_status};
pub(crate) use configuration::*;
pub(crate) use discovery::*;
pub(crate) use launch::*;
pub(crate) use state::*;
