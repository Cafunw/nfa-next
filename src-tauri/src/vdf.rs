//! Minimal text-VDF (Valve KeyValues) parser + serializer.
//! Preserves key order; handles nested objects, quoted strings and // comments.

#[derive(Debug, Clone)]
pub enum Vdf {
    Str(String),
    Obj(Vec<(String, Vdf)>),
}

impl Vdf {
    pub fn obj(&self) -> Option<&Vec<(String, Vdf)>> {
        match self {
            Vdf::Obj(v) => Some(v),
            _ => None,
        }
    }
    pub fn obj_mut(&mut self) -> Option<&mut Vec<(String, Vdf)>> {
        match self {
            Vdf::Obj(v) => Some(v),
            _ => None,
        }
    }
    pub fn get(&self, key: &str) -> Option<&Vdf> {
        self.obj()?.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }
    /// Like `get`, ignoring case (Steam is inconsistent: "Software", "steam").
    pub fn get_ci(&self, key: &str) -> Option<&Vdf> {
        self.obj()?.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v)
    }
    pub fn get_mut(&mut self, key: &str) -> Option<&mut Vdf> {
        self.obj_mut()?
            .iter_mut()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v)
    }
    pub fn get_str(&self, key: &str) -> Option<&str> {
        match self.get(key)? {
            Vdf::Str(s) => Some(s),
            _ => None,
        }
    }
    /// Insert or replace a string value in an object, keeping order.
    pub fn set_str(&mut self, key: &str, val: &str) {
        if let Vdf::Obj(v) = self {
            if let Some(e) = v.iter_mut().find(|(k, _)| k == key) {
                e.1 = Vdf::Str(val.to_string());
            } else {
                v.push((key.to_string(), Vdf::Str(val.to_string())));
            }
        }
    }
}

struct Lexer<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Lexer<'a> {
    fn new(s: &'a str) -> Self {
        Lexer { b: s.as_bytes(), i: 0 }
    }
    fn skip_ws(&mut self) {
        while self.i < self.b.len() {
            let c = self.b[self.i];
            if c == b' ' || c == b'\t' || c == b'\r' || c == b'\n' {
                self.i += 1;
            } else if c == b'/' && self.i + 1 < self.b.len() && self.b[self.i + 1] == b'/' {
                while self.i < self.b.len() && self.b[self.i] != b'\n' {
                    self.i += 1;
                }
            } else {
                break;
            }
        }
    }
    fn token(&mut self) -> Option<Tok> {
        self.skip_ws();
        if self.i >= self.b.len() {
            return None;
        }
        let c = self.b[self.i];
        if c == b'{' {
            self.i += 1;
            return Some(Tok::Open);
        }
        if c == b'}' {
            self.i += 1;
            return Some(Tok::Close);
        }
        if c == b'"' {
            self.i += 1;
            // collect raw bytes, decode as UTF-8 once (byte-as-char broke ü, ş, emoji)
            let mut s: Vec<u8> = Vec::new();
            while self.i < self.b.len() {
                let c = self.b[self.i];
                if c == b'\\' && self.i + 1 < self.b.len() {
                    let n = self.b[self.i + 1];
                    s.push(match n {
                        b'n' => b'\n',
                        b't' => b'\t',
                        other => other, // \\ and \" map to themselves
                    });
                    self.i += 2;
                    continue;
                }
                if c == b'"' {
                    self.i += 1;
                    break;
                }
                s.push(c);
                self.i += 1;
            }
            return Some(Tok::Str(String::from_utf8_lossy(&s).into_owned()));
        }
        // unquoted token
        let start = self.i;
        while self.i < self.b.len() {
            let c = self.b[self.i];
            if c == b' ' || c == b'\t' || c == b'\r' || c == b'\n' || c == b'{' || c == b'}' {
                break;
            }
            self.i += 1;
        }
        Some(Tok::Str(
            String::from_utf8_lossy(&self.b[start..self.i]).to_string(),
        ))
    }
}

enum Tok {
    Open,
    Close,
    Str(String),
}

pub fn parse(input: &str) -> Result<Vdf, String> {
    let mut lx = Lexer::new(input);
    let mut root: Vec<(String, Vdf)> = Vec::new();
    loop {
        match lx.token() {
            None => break,
            Some(Tok::Str(key)) => {
                let val = parse_value(&mut lx)?;
                root.push((key, val));
            }
            Some(Tok::Close) => break,
            Some(Tok::Open) => return Err("unexpected '{'".into()),
        }
    }
    Ok(Vdf::Obj(root))
}

fn parse_value(lx: &mut Lexer) -> Result<Vdf, String> {
    match lx.token() {
        Some(Tok::Str(s)) => Ok(Vdf::Str(s)),
        Some(Tok::Open) => {
            let mut v: Vec<(String, Vdf)> = Vec::new();
            loop {
                match lx.token() {
                    Some(Tok::Close) => break,
                    Some(Tok::Str(key)) => {
                        let val = parse_value(lx)?;
                        v.push((key, val));
                    }
                    Some(Tok::Open) => return Err("unexpected '{' as key".into()),
                    None => return Err("unexpected EOF in object".into()),
                }
            }
            Ok(Vdf::Obj(v))
        }
        Some(Tok::Close) => Err("unexpected '}'".into()),
        None => Err("unexpected EOF".into()),
    }
}

pub fn serialize(v: &Vdf) -> String {
    let mut out = String::new();
    if let Vdf::Obj(items) = v {
        for (k, val) in items {
            write_kv(&mut out, k, val, 0);
        }
    }
    out
}

fn write_indent(out: &mut String, depth: usize) {
    for _ in 0..depth {
        out.push('\t');
    }
}

fn write_kv(out: &mut String, key: &str, val: &Vdf, depth: usize) {
    write_indent(out, depth);
    out.push('"');
    out.push_str(&esc(key));
    out.push('"');
    match val {
        Vdf::Str(s) => {
            out.push_str("\t\t\"");
            out.push_str(&esc(s));
            out.push_str("\"\n");
        }
        Vdf::Obj(items) => {
            out.push('\n');
            write_indent(out, depth);
            out.push_str("{\n");
            for (k, v) in items {
                write_kv(out, k, v, depth + 1);
            }
            write_indent(out, depth);
            out.push_str("}\n");
        }
    }
}

fn esc(s: &str) -> String {
    // Steam escapes only \\ and \"; raw tabs/newlines inside values stay raw (seen in config.vdf)
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
