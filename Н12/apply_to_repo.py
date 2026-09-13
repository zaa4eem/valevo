from __future__ import annotations

import argparse
import importlib.util
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

AUDITED_MAIN_SHA = "5c946a8f17df387d384fb108520cb7db505645fa"


def run(args: list[str], cwd: Path, *, capture: bool = False) -> str:
    print('+', ' '.join(args))
    result = subprocess.run(
        args,
        cwd=cwd,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )
    return (result.stdout or '').strip()


def main() -> int:
    parser = argparse.ArgumentParser(description='Apply production-ready VALEVO Н12 booking/finance Mini App patch')
    parser.add_argument('repo', nargs='?', default='.', help='path to valevo repository root')
    parser.add_argument('--no-checks', action='store_true', help='skip compile/JS/local integration checks')
    parser.add_argument('--force-dirty', action='store_true', help='allow changes when touched target files are already dirty')
    ns = parser.parse_args()

    repo = Path(ns.repo).resolve()
    pkg = Path(__file__).resolve().parent
    h12 = repo / 'Н12'
    if not (h12 / 'handlers' / 'booking.py').exists():
        print(f'ERROR: {repo} is not the valevo repository root (Н12/handlers/booking.py not found)', file=sys.stderr)
        return 2
    if not (repo / '.git').exists():
        print('ERROR: repository root does not contain .git', file=sys.stderr)
        return 2

    copies = {
        pkg / 'services' / 'booking_finance.py': h12 / 'services' / 'booking_finance.py',
        pkg / 'webapp' / 'api.py': h12 / 'webapp' / 'api.py',
        pkg / 'webapp' / 'static' / 'index.html': h12 / 'webapp' / 'static' / 'index.html',
        pkg / 'webapp' / 'static' / 'js' / 'app.js': h12 / 'webapp' / 'static' / 'js' / 'app.js',
        pkg / 'webapp' / 'static' / 'css' / 'app.css': h12 / 'webapp' / 'static' / 'css' / 'app.css',
        pkg / 'scripts' / 'test_booking_finance.py': h12 / 'scripts' / 'test_booking_finance.py',
        pkg / 'scripts' / 'preflight_production.py': h12 / 'scripts' / 'preflight_production.py',
        pkg / 'docker' / 'Dockerfile.webapp': h12 / 'Dockerfile.webapp',
        pkg / 'docker' / 'docker-compose.yml': h12 / 'docker-compose.yml',
        pkg / 'docker' / 'webapp_server.py': h12 / 'webapp_server.py',
        pkg / 'deploy' / 'nginx-valevo.conf.example': h12 / 'deploy' / 'nginx-valevo.conf.example',
        pkg / 'deploy' / 'PRODUCTION_RUNBOOK.md': h12 / 'deploy' / 'PRODUCTION_RUNBOOK.md',
        pkg / '.env.example': h12 / '.env.example',
    }

    patch_targets = [
        h12 / 'config.py',
        h12 / 'handlers' / 'booking.py',
        h12 / 'database' / 'bookings.py',
    ]
    all_targets = list(dict.fromkeys([*patch_targets, *copies.values()]))

    if not ns.force_dirty:
        rels = [str(path.relative_to(repo)) for path in all_targets if path.exists()]
        dirty = run(['git', 'status', '--porcelain', '--', *rels], repo, capture=True) if rels else ''
        if dirty:
            print('ERROR: target files contain uncommitted changes. Commit/stash them or use --force-dirty.', file=sys.stderr)
            print(dirty, file=sys.stderr)
            return 3

    try:
        head = run(['git', 'rev-parse', 'HEAD'], repo, capture=True)
        if head != AUDITED_MAIN_SHA:
            print(f'NOTE: HEAD is {head[:12]}, audited main was {AUDITED_MAIN_SHA[:12]}. git apply --check will decide compatibility.')
    except Exception:
        head = 'unknown'

    patch = pkg / 'patches' / 'main_changes.patch'
    run(['git', 'apply', '--check', '--recount', str(patch)], repo)

    with tempfile.TemporaryDirectory(prefix='valevo-prod-rollback-') as tmp:
        backup = Path(tmp)
        existed: dict[Path, bool] = {}
        for target in all_targets:
            existed[target] = target.exists()
            if target.exists():
                dst = backup / target.relative_to(repo)
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, dst)

        try:
            run(['git', 'apply', '--recount', str(patch)], repo)
            for src, dst in copies.items():
                if not src.exists():
                    raise FileNotFoundError(src)
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
                print(f'copied {dst.relative_to(repo)}')

            if not ns.no_checks:
                run([sys.executable, '-m', 'compileall', '-q', 'Н12'], repo)
                node = shutil.which('node')
                if node:
                    run([node, '--check', 'Н12/webapp/static/js/app.js'], repo)
                else:
                    print('NOTE: node not found; JS syntax check skipped')

                run([sys.executable, 'Н12/scripts/preflight_production.py', '--static-only'], repo)

                if importlib.util.find_spec('aiosqlite'):
                    run([sys.executable, 'scripts/test_booking_finance.py'], h12)
                else:
                    print('NOTE: aiosqlite not installed in this interpreter; runtime finance test skipped. It will be available after pip install -r requirements.txt.')
        except Exception:
            print('ERROR: apply/check failed; restoring every touched file...', file=sys.stderr)
            for target in all_targets:
                backup_path = backup / target.relative_to(repo)
                if existed[target]:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(backup_path, target)
                elif target.exists():
                    if target.is_file() or target.is_symlink():
                        target.unlink()
                    else:
                        shutil.rmtree(target)
            raise

    print('\nSUCCESS: production patch applied.')
    print('Next:')
    print('  cd Н12')
    print('  cp .env.example .env   # then fill NEW rotated secrets')
    print('  python scripts/preflight_production.py')
    print('  docker compose build --pull')
    print('  docker compose up -d')
    print('  docker compose ps')
    print('  curl -fsS http://127.0.0.1:${WEBAPP_PORT:-8080}/api/ready')
    print('Review: git diff -- Н12')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
