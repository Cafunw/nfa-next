//! Token encryption with Windows DPAPI (CryptProtectData).
//! Only the same Windows user on the same PC can decrypt the result.

use base64::{engine::general_purpose::STANDARD, Engine};

const ENTROPY: &[u8] = b"nfa-next/token/v1";

#[cfg(windows)]
fn run(data: &[u8], encrypt: bool) -> Option<Vec<u8>> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let entropy = CRYPT_INTEGER_BLOB { cbData: ENTROPY.len() as u32, pbData: ENTROPY.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe {
        if encrypt {
            CryptProtectData(&input, std::ptr::null(), &entropy, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        } else {
            CryptUnprotectData(&input, std::ptr::null_mut(), &entropy, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        }
    };
    if ok == 0 || out.pbData.is_null() {
        return None;
    }
    let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
    unsafe { LocalFree(out.pbData as _) };
    Some(bytes)
}

#[cfg(not(windows))]
fn run(_data: &[u8], _encrypt: bool) -> Option<Vec<u8>> {
    None
}

/// Encrypt a token and return it as base64.
pub fn protect(plain: &str) -> Option<String> {
    run(plain.as_bytes(), true).map(|b| STANDARD.encode(b))
}

/// Decrypt a base64 blob produced by `protect`.
pub fn unprotect(enc: &str) -> Option<String> {
    let raw = STANDARD.decode(enc.trim()).ok()?;
    String::from_utf8(run(&raw, false)?).ok()
}
