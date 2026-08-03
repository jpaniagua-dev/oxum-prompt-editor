# oxum-prompt-editor — instructions projet

Éditeur de prompts Markdown en popup Windows (Electron + TypeScript strict + CodeMirror 6).

## Invariant central : le texte de l'utilisateur ne se perd jamais

C'est la raison d'être de l'app, pas une qualité parmi d'autres. Toute modification doit
préserver ces propriétés :

- **Aucun geste de l'UI ne détruit le buffer.** `Esc` et le bouton de fermeture masquent la
  fenêtre. On ne quitte que par le menu du tray.
- **Toute écriture de fichier passe par `atomicWriteFile`** (`src/main/store/atomic-write.ts`) :
  temp + rename, jamais `writeFile` direct sur un fichier de données. Un `writeFile` tronque
  avant d'écrire, donc un crash au mauvais moment détruit le brouillon.
- **Toute action qui remplace ou vide le buffer archive d'abord** un instantané via
  `snapshotDraft`. Cela concerne `Nouveau`, `Appliquer` une réécriture, et `restaurer`.
- **Un remplacement de document se fait en une seule transaction CodeMirror** (`replaceAll`),
  pour qu'un unique `Ctrl+Z` le défasse.

Ajouter une fonctionnalité qui viole l'un de ces points est un régression, même si elle est
pratique.

## Contraintes techniques à ne pas casser

- **Pas de `"type": "module"` dans `package.json`.** Le preload tourne avec `sandbox: true`, et
  Electron n'accepte alors qu'un preload CommonJS. Passer le paquet en ESM casse le bridge.
- **`src/shared/contracts.ts` est la source unique** des canaux IPC. Un nouveau canal s'ajoute
  là, puis dans `ipc.ts`, puis dans `preload/index.ts`. Ne jamais exposer `ipcRenderer` ni un
  canal générique au renderer.
- **Le renderer n'a ni `fs` ni `child_process`.** Il reste sandboxé, avec CSP verrouillée et
  aucun contenu distant. Construire le DOM avec `textContent`, jamais `innerHTML` : le texte
  vient de l'utilisateur et du CLI.
- **L'éditeur manipule du Markdown source**, stylé mais jamais transformé. Ne pas introduire de
  sérialiseur WYSIWYG : il altérerait blocs de code, backticks et indentation.
- **Le brouillon passe au CLI par stdin**, jamais en argv (limite ~32k sur Windows, plus l'enfer
  du quoting).
- **Chaque preset de réécriture interdit d'inventer du contenu** et renvoie les zones floues dans
  une section `## À préciser`. Sans cette contrainte, le modèle fabrique des exigences absentes
  de l'entrée. Un test le vérifie.

## Commandes

```bash
npm run dev        # lance l'app depuis les sources
npm test           # Vitest sur les unités pures
npm run lint       # ESLint, zéro warning toléré
npm run typecheck  # tsc sur les projets node et web
npm run dist       # installeur NSIS per-user + portable dans release/
```

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess`, aucun `any`.
- Code et commentaires **en anglais**. Textes affichés à l'utilisateur en **français**.
- Les commentaires expliquent le *pourquoi* d'un choix non évident, pas la paraphrase du code.
- Tests : couvrir les unités pures (écriture atomique, parsing du flux, pruning, sanitisation).
  Pas de e2e Electron.
