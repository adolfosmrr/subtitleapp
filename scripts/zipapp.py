# Zip de un .app preservando symlinks y permisos (equivalente a `ditto -c -k --keepParent`)
import os, sys, zipfile, stat
src, out = sys.argv[1], sys.argv[2]
base = os.path.dirname(src.rstrip('/'))
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, dirs, files in os.walk(src):
        for name in dirs + files:
            p = os.path.join(root, name); rel = os.path.relpath(p, base)
            st = os.lstat(p)
            if stat.S_ISLNK(st.st_mode):
                zi = zipfile.ZipInfo(rel); zi.create_system = 3; zi.external_attr = (0o120755 << 16)
                z.writestr(zi, os.readlink(p))
            elif stat.S_ISDIR(st.st_mode):
                if os.path.islink(p): continue
                zi = zipfile.ZipInfo(rel + '/'); zi.create_system = 3; zi.external_attr = ((0o40755) << 16) | 0x10
                z.writestr(zi, b'')
            else:
                zi = zipfile.ZipInfo.from_file(p, rel); zi.create_system = 3; zi.external_attr = (st.st_mode & 0xFFFF) << 16; zi.compress_type = zipfile.ZIP_DEFLATED
                with open(p, 'rb') as f: z.writestr(zi, f.read(), compresslevel=9)
print('zip ok', out, os.path.getsize(out))
