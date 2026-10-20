"""Import actual released-template downloads with official core; compare frozen public fields."""
import hashlib, html, importlib.metadata, json, re, sys, zipfile
from pathlib import Path
from anki.collection import Collection, ImportAnkiPackageRequest, ImportAnkiPackageOptions
assert importlib.metadata.version('anki') == '26.9.3'
root = Path(sys.argv[1])
work = root / (sys.argv[2] if len(sys.argv) > 2 else 'official-import')
work.mkdir()
reports = []
for phase in ['graded', 'corrected']:
    for consent in ['off', 'on']:
        stem = phase + '-' + consent
        package = root / (stem + '.apkg')
        public = json.loads((root / (stem + '-projection.json')).read_text())
        escape = lambda s: html.escape(s, quote=True).replace('&#x27;', '&#39;')
        expected = {hashlib.sha256(('studens/' + public['name'] + '/' + p['identity']).encode()).hexdigest()[:20]: [escape(p['title']), re.sub('studens-media:([\\w.-]+)', '\\1', p['html']), '<a href="' + escape(p['source']) + '">' + escape(p['source']) + '</a>'] for p in public['parts']}
        c = Collection(str(work / (stem + '.anki2')))
        try:
            req = ImportAnkiPackageRequest(package_path=str(package), options=ImportAnkiPackageOptions(with_scheduling=False, with_deck_configs=False))
            c.import_anki_package(req)
            notes = {c.get_note(n).guid: list(c.get_note(n).fields) for n in c.find_notes('')}
            assert notes == expected
            serialized = json.dumps(notes, ensure_ascii=False)
            assert not re.search(r'CANARY|731987654|key-(choice|multi|order|left|right|segment)', serialized)
            answers = [fields for fields in notes.values() if '<h3>Expected answer</h3>' in fields[1]]
            assert len(answers) == (0 if consent == 'off' else 7 if phase == 'corrected' else 6)
            if consent == 'on':
                assert any('<pre>New owner — café λ</pre>' in f[1] for f in answers)
                assert any('Resource → New binding\nScope → Lifetime' in f[1] for f in answers)
                assert any('1. Release\n2. Allocate' in f[1] for f in answers)
                assert any('<pre>The released passage 日本語</pre>' in f[1] for f in answers)
                assert any('<pre>29 (tolerance: ±0)</pre>' in f[1] for f in answers) == (phase == 'corrected')
            ids = (c.find_notes(''), c.find_cards(''))
            c.import_anki_package(req)
            assert ids == (c.find_notes(''), c.find_cards(''))
            assert c.db.scalar('select count(*) from revlog') == 0
            assert all(c.get_card(i).reps == 0 for i in c.find_cards(''))
            assert all(c.decks.name(c.get_card(i).did).endswith('(gates)') for i in c.find_cards(''))
            with zipfile.ZipFile(package) as z:
                media = json.loads(z.read('media'))
                for key, name in media.items():
                    actual = (Path(c.media.dir()) / name).read_bytes()
                    assert actual == z.read(key)
                    if stem == 'corrected-on':
                        (work / name).write_bytes(actual)
            if stem == 'corrected-on':
                card = next(c.get_card(i) for i in c.find_cards('') if '<pre>New owner — café λ</pre>' in c.get_note(c.get_card(i).nid).fields[1])
                (work / 'answer-card.html').write_text('<!doctype html><meta charset="utf-8"><style>body{font:18px/1.5 sans-serif;padding:2rem}</style>' + card.answer())
            reports.append({'package': package.name, 'sha256': hashlib.sha256(package.read_bytes()).hexdigest(), 'notes': len(notes), 'cards': len(c.find_cards('')), 'answerCards': len(answers), 'exactFrozenPublicFields': True, 'stableReimport': True, 'reviewHistoryRows': 0})
        finally:
            c.close()
report = {'verdict': 'PASS', 'anki': importlib.metadata.version('anki'), 'python': sys.version, 'packages': reports, 'scope': 'Actual browser downloads, official core import/reimport. No desktop/mobile Anki UI.'}
(work / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
