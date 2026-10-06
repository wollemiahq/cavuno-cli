/** Narrow, case-sensitive exceptions for public starter source files. */
export function isApprovedBuilderConfigPath(path: string): boolean {
  return (
    path === '.cavuno/locale-setup.json' ||
    path === '.npmrc' ||
    path === '.dev.vars.example'
  );
}

export function isBuilderCredentialPath(path: string): boolean {
  return path.split('/').some((segment) => {
    const name = segment.toLowerCase();
    return (
      name === '.cavuno' ||
      name === '.ssh' ||
      name === '.aws' ||
      name.startsWith('.env') ||
      name.startsWith('.dev.vars') ||
      [
        '.npmrc',
        '.yarnrc',
        '.pnpmfile.cjs',
        '.pnpmfile.mjs',
        '.pypirc',
        '.netrc',
        'credentials.json',
        'id_rsa',
        'id_ed25519',
      ].includes(name) ||
      /\.(?:pem|key|p(?:12|fx))$/u.test(name)
    );
  });
}

export function isSafeBuilderConfig(path: string, bytes: Uint8Array): boolean {
  if (path === '.cavuno/locale-setup.json') return true;
  if (path !== '.npmrc' && path !== '.dev.vars.example') return false;
  if (bytes.length > 4096) return false;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  if (
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffd\u202a-\u202e\u2066-\u2069]/u.test(
      text,
    )
  )
    return false;
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (path === '.npmrc')
    return lines.length === 1 && /^min-release-age=\d+$/u.test(lines[0]!);
  if (!lines.length) return false;
  const seen = new Set<string>();
  for (const line of lines) {
    const match = /^([A-Z_]+)=(.*)$/u.exec(line);
    if (!match) return false;
    const name = match[1]!;
    let value = match[2]!;
    if (seen.has(name)) return false;
    seen.add(name);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    if (/[\s$`"'\\]/u.test(value)) return false;
    if (name === 'CAVUNO_BOARD') {
      if (!/^pk_[a-z0-9_]{1,96}$/iu.test(value)) return false;
    } else if (name === 'CAVUNO_DEV_TOOLS') {
      if (!/^(?:0|1|true|false)$/u.test(value)) return false;
    } else if (name === 'CAVUNO_API_URL') {
      try {
        const url = new URL(value);
        if (
          !/^https?:\/\//u.test(value) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          value.includes('?') ||
          value.includes('#') ||
          (url.protocol !== 'https:' &&
            !(
              url.protocol === 'http:' &&
              /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/u.test(
                value,
              )
            ))
        )
          return false;
      } catch {
        return false;
      }
    } else return false;
  }
  return true;
}
