"""Verify actual browser-downloaded Studens packages through official Anki core, never TSV."""
import hashlib, html, importlib.metadata, json, re, sys, zipfile
from pathlib import Path
from anki.collection import Collection, ImportAnkiPackageRequest, ImportAnkiPackageOptions
assert importlib.metadata.version('anki') == '26.9.3', 'Use the pinned official Anki core for this acceptance check.'
root = Path(sys.argv[1])
work = root / (sys.argv[2] if len(sys.argv) > 2 else 'official-import')
work.mkdir()
reports = []
for filename, projection in [('rust.apkg', 'projection.json'), ('rust-answers.apkg', 'projection-answers.json'), ('empty.apkg', None)]:
    package = root / filename
    z = zipfile.ZipFile(package)
    public = json.loads((root / projection).read_text()) if projection else {'name': 'empty', 'parts': [], 'media': []}
    expected = {hashlib.sha256(('studens/' + public['name'] + '/' + p['identity']).encode()).hexdigest()[:20]: [html.escape(p['title'], quote=True).replace('&#x27;', '&#39;'), re.sub('studens-media:([\\w.-]+)', '\\1', p['html']), '<a href="' + html.escape(p['source'], quote=True).replace('&#x27;', '&#39;') + '">' + html.escape(p['source'], quote=True).replace('&#x27;', '&#39;') + '</a>'] for p in public['parts']}
    c = Collection(str(work / (filename + '.anki2')))
    try:
        req = ImportAnkiPackageRequest(package_path=str(package), options=ImportAnkiPackageOptions(with_scheduling=False, with_deck_configs=False))
        imported = c.import_anki_package(req)
        notes = {c.get_note(n).guid: list(c.get_note(n).fields) for n in c.find_notes('')}
        assert notes == expected, (filename, 'imported fields differ from frozen projection', set(notes) - set(expected), set(expected) - set(notes))
        cards = c.find_cards('')
        assert len(cards) == len(expected)
        assert all((c.get_card(i).reps == 0 and c.get_card(i).lapses == 0 and (c.get_card(i).ivl == 0) for i in cards))
        assert c.db.scalar('select count(*) from revlog') == 0
        assert all((c.decks.name(c.get_card(i).did).startswith('Studens::') and '(' + public['name'] + ')' in c.decks.name(c.get_card(i).did) for i in cards))
        serialized = json.dumps(notes, ensure_ascii=False)
        assert not re.search('PRIVATE_|GATED_|studens-course-map', serialized)
        if filename == 'rust.apkg':
            assert 'UNLOCKED_EXPECTED' not in serialized
            for value in ['日本語', 'café', 'const text', 'console.log(text &lt;', 'flowchart LR', 'public reply', 'Actual saved evidence', 'First saved item', 'Second saved item', 'Inline label — λ', '日本語 café']:
                assert value in serialized, ('missing saved content', value)
        if filename == 'rust-answers.apkg':
            assert 'UNLOCKED_EXPECTED' in serialized and 'new owner' in serialized
        media = json.loads(z.read('media'))
        media_hashes = {}
        for key, name in media.items():
            actual = (Path(c.media.dir()) / name).read_bytes()
            assert actual == z.read(key)
            media_hashes[name] = hashlib.sha256(actual).hexdigest()
        assert len(public['media']) + 1 == len(media)
        if filename != 'empty.apkg':
            svg_media = [z.read(key).decode() for key, name in media.items() if name.endswith('.svg')]
            assert len(svg_media) == 1
            assert 'Referenced label — λ' in svg_media[0] and '日本語 café' in svg_media[0]
            assert not re.search('PRIVATE_|foreignObject|onload|https://invalid', svg_media[0])
        original_ids = (c.find_notes(''), c.find_cards(''))
        c.import_anki_package(req)
        assert (c.find_notes(''), c.find_cards('')) == original_ids
        report = {'package': filename, 'sha256': hashlib.sha256(package.read_bytes()).hexdigest(), 'notes': len(notes), 'cards': len(cards), 'exactFrozenFields': True, 'stableGuidsOnReimport': True, 'media': media_hashes, 'reviewHistoryRows': 0, 'reps': 0}
        if filename == 'rust.apkg':
            nid = next((n for n in c.find_notes('') if c.get_note(n).fields[0] == 'ownership.md'))
            original_guid = c.get_note(nid).guid
            note = c.get_note(nid)
            note.fields[1] += '<p>LOCAL_USER_EDIT</p>'
            c.update_note(note)
            c.import_anki_package(req)
            assert 'LOCAL_USER_EDIT' in c.get_note(nid).fields[1]
            updates = Collection(str(work / 'updates.anki2'))
            try:
                updates.import_anki_package(req)
                updated_nid = next((n for n in updates.find_notes('') if updates.get_note(n).guid == original_guid))
                edited = root / 'rust-edited.apkg'
                updates.import_anki_package(ImportAnkiPackageRequest(package_path=str(edited), options=ImportAnkiPackageOptions(with_scheduling=False, with_deck_configs=False)))
                assert len(updates.find_notes('')) == len(expected) and 'UPDATED_NOTE' in updates.get_note(updated_nid).fields[1] and (updates.get_note(updated_nid).guid == original_guid)
                removed = root / 'rust-removed.apkg'
                updates.import_anki_package(ImportAnkiPackageRequest(package_path=str(removed), options=ImportAnkiPackageOptions(with_scheduling=False, with_deck_configs=False)))
                assert len(updates.find_notes('')) == len(expected) and updates.get_note(updated_nid).guid == original_guid
            finally:
                updates.close()
            additive = Collection(str(work / 'additive.anki2'))
            try:
                control = additive.new_note(additive.models.by_name('Basic'))
                control['Front'] = 'Existing unrelated note'
                control['Back'] = 'Preserve this saved local card.'
                additive.add_note(control, additive.decks.id('Existing local deck'))
                control_guid = control.guid
                additive.import_anki_package(req)
                assert len(additive.find_notes('')) == len(expected) + 1
                assert any((additive.get_note(n).guid == control_guid for n in additive.find_notes('')))
            finally:
                additive.close()
            report.update(localEditPreservedOnUnchangedImport=True, newerSourceUpdatedSameGuid=True, removedSourceDoesNotDeleteAnkiNote=True, existingUnrelatedCollectionNotePreserved=True)
            lesson_card = next((c.get_card(i) for i in cards if c.get_note(c.get_card(i).nid).fields[0] == 'Ownership'))
            rendered = lesson_card.answer()
            card_dir = work / 'rendered-card'
            card_dir.mkdir()
            for name in media.values():
                (card_dir / name).write_bytes((Path(c.media.dir()) / name).read_bytes())
            (card_dir / 'card.html').write_text('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:18px/1.5 sans-serif;max-width:900px;margin:2rem auto;padding:1rem}pre{white-space:pre-wrap}img,svg{max-width:100%}</style>' + rendered)
        if filename == 'rust-answers.apkg':
            lesson_card = next(c.get_card(i) for i in cards if c.get_note(c.get_card(i).nid).fields[0] == 'Ownership')
            (work / 'rendered-card' / 'answers.html').write_text('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:18px/1.5 sans-serif;max-width:900px;margin:2rem auto;padding:1rem}pre{white-space:pre-wrap}img,svg{max-width:100%}</style>' + lesson_card.answer())
        reports.append(report)
    finally:
        c.close()
report = {'verdict': 'PASS', 'ankiVersion': importlib.metadata.version('anki'), 'python': sys.version, 'packages': reports, 'desktopUiVerified': False, 'limit': 'Official Collection.import_anki_package and card rendering; no Anki desktop executable.'}
(work / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
