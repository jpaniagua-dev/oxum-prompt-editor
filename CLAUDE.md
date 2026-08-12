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
- **Chaque preset de réécriture interdit d'inventer du contenu** (`CORE_RULES`). Sans cette
  contrainte, le modèle fabrique des exigences absentes de l'entrée. Elle vaut pour tous les
  presets, sans exception, et un test le vérifie.
- **Le renvoi des zones floues vers `## À préciser` ne concerne que la famille `agent-prompt`**
  (`AGENT_PROMPT_RULES`). Le champ `kind` de `RewritePreset` porte la distinction : `agent-prompt`
  produit un prompt Markdown pour un agent de code, `text` produit un texte lu par un humain
  (`Corriger`, `Chat`). Coller une section de questions à la fin d'un texte que l'utilisateur
  envoie tel quel est un défaut, pas une garantie. Un test vérifie les deux familles.
- **Le dev tourne sur son propre `userData`** (`-dev`), défini avant `requestSingleInstanceLock`.
  Le supprimer ferait écrire les tests dans les vrais brouillons et empêcherait de lancer les
  sources quand l'app installée est ouverte.
- **Aucune mention de l'employeur, de sa charte ou d'un hub interne** dans ce dépôt : il est
  public. Les tokens de couleur restent nommés `--brand-*`.

## Pièges vérifiés sur les raccourcis et le thème

Ces points ont coûté du temps à diagnostiquer, ne pas les réintroduire :

- **`Prec.highest()` sur le keymap de l'app est obligatoire.** L'ordre dans le tableau
  d'extensions ne suffit pas : `searchKeymap` réserve `Mod-Shift-l`, `Mod-d`, `Mod-f`, `Mod-g` et
  gagnait malgré une position antérieure.
- **Pas de raccourci à base de chiffre avec `Shift`.** La disposition compte : sur un clavier
  suisse romand, `Ctrl+Shift+7` arrive en `Ctrl+/` et déclenche le basculement de commentaire.
  Les chiffres sans `Shift` (`Ctrl+1..3`) sont stables.
- **`Ctrl+Shift+O` n'atteint jamais le renderer** : Chromium le garde pour ses favoris.
- **`.cm-activeLine` se déclare dans `EditorView.theme`, pas dans la feuille de style.**
  `highlightActiveLine` fournit une règle `baseTheme` plus spécifique qu'un sélecteur de
  stylesheet, et son défaut est un lavis bleu hors palette.
- **Le thème est résolu dans le main**, jamais dans le renderer : le `backgroundColor` de la
  fenêtre est peint avant le rendu de la page, donc une double source de vérité produit un flash
  blanc à chaque ouverture en mode sombre.
- **`EditorState.allowMultipleSelections.of(true)`** est requis, sinon un state ne garde que sa
  plage principale et le multi-curseur échoue silencieusement (y compris dans les tests).

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
- **Messages de commit en anglais**, au présent et à l'impératif (`Add`, `Fix`, `Refactor`),
  première lettre en majuscule, pas de point final, pas d'emoji. L'historique a été réécrit le
  2026-08-12 pour appliquer cette règle : ne pas se fier au style d'un vieux commit pour la
  contredire.
- Les commentaires expliquent le *pourquoi* d'un choix non évident, pas la paraphrase du code.
- Tests : couvrir les unités pures (écriture atomique, parsing du flux, pruning, sanitisation).
  Pas de e2e Electron.
