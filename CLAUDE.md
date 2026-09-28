# oxum-prompt-editor — instructions projet

Éditeur Markdown en popup Windows (Electron + TypeScript strict + CodeMirror 6), né pour écrire
des prompts et devenu un outil d'édition rapide : corriger, traduire, changer de registre, puis
coller le résultat ailleurs. Le vocabulaire de l'UI suit cet usage (« brouillon », pas « prompt »),
sauf là où il s'agit vraiment d'un prompt (famille `agent-prompt`, bibliothèque de prompts).

## Invariant central : le texte de l'utilisateur ne se perd jamais

C'est la raison d'être de l'app, pas une qualité parmi d'autres. Toute modification doit
préserver ces propriétés :

- **Aucun geste de l'UI ne détruit le buffer.** `Esc` et le bouton `✕` de la barre de titre
  masquent la fenêtre. Quitter se fait par le menu du tray **ou par le bouton en pied de la page de
  réglages**, et les deux passent par la même fonction `quit()` : flush du brouillon, instantané
  final, sauvegarde des bounds, puis sortie. ⚠️ Ne jamais câbler une fermeture sur
  `window.close()` côté renderer, elle sauterait les trois.
- **Toute écriture de fichier passe par `atomicWriteFile`** (`src/main/store/atomic-write.ts`) :
  temp + rename, jamais `writeFile` direct sur un fichier de données. Un `writeFile` tronque
  avant d'écrire, donc un crash au mauvais moment détruit le brouillon.
- **Toute action qui remplace ou vide le buffer archive d'abord** un instantané via
  `snapshotDraft`. Cela concerne `Nouveau`, `Appliquer` une réécriture, `restaurer` un
  instantané et **charger une note**. Copier un prompt de la bibliothèque ne touche pas au
  buffer, donc n'a rien à archiver.
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
- **L'aperçu ne parse jamais d'HTML.** `src/renderer/preview/render-markdown.ts` parcourt l'arbre
  Lezer et construit chaque nœud explicitement, avec la même liste d'extensions que
  `markdownLanguage` : une seule grammaire colore et rend le même document. C'est le prolongement de
  la règle « jamais `innerHTML` », pas une préférence de style, donc ne pas remplacer ce parcours
  par un rendu de chaîne. Deux conséquences sont assumées et non des manques à combler : les images
  deviennent des chips étiquetées (la CSP du renderer n'autorise aucune des sources vers lesquelles
  pointe une image Markdown) et les liens partent dans le navigateur système, une fenêtre sans
  navigation n'ayant aucun retour possible.
- **Le brouillon passe au CLI par stdin**, jamais en argv (limite ~32k sur Windows, plus l'enfer
  du quoting). Les instructions du preset restent séparées : `--system-prompt` pour Claude,
  argument de prompt pour `codex exec`.
- **Deux régimes de stockage.** `HistoryStore` accumule tout seul, donc ses instantanés sont
  jetables : pruning à 200 et purge explicite (`clear()`). `LibraryStore` ne prune **jamais** et ne
  supprime que sur demande, une entrée à la fois : elle a été créée exprès. Inverser ces deux
  régimes serait la perte de données que l'app existe pour empêcher.
- **`LibraryStore` sert deux bibliothèques**, `notes` et `prompts` (`LibraryId`), par deux
  instances sur deux dossiers. La classe ignore laquelle elle sert : la différence est dans le
  panneau. Une note se **charge dans l'éditeur** (donc snapshot du brouillon d'abord), un prompt se
  **copie dans le presse-papier** sans toucher au brouillon. C'est précisément ce qui justifie deux
  dossiers plutôt qu'un : prendre un prompt fréquent ne doit rien coûter à ce qu'on est en train
  d'écrire.
- **Les canaux `library:*` prennent un `LibraryId` en premier argument.** Un discriminant typé vaut
  mieux que cinq canaux de plus, et ce n'est pas un canal générique : `libraryOf()` le résout
  contre une table fixe de stores côté main, donc le renderer ne nomme jamais une destination
  arbitraire.
- **Les dossiers des bibliothèques sont configurables**, donc résolus par un `() => string` à
  chaque appel et pas figés au constructeur. Deux conséquences : `DOCUMENT_ID_PATTERN` est la seule
  barrière contre la traversée de chemin dans un dossier qui peut être n'importe où, et changer le
  réglage **ne déplace pas** les fichiers existants (un déplacement raté à mi-course est exactement
  le risque qu'on refuse).
- **Un fichier ouvert du disque est en lecture seule, et le rester est une décision.**
  `FileStore` (`src/main/store/file-store.ts`) n'a qu'une méthode, `open`, et l'app n'expose aucun
  canal d'écriture externe : `Ctrl+S` n'existe pas. Ce que l'app produit est du texte à coller
  ailleurs, déjà persisté dans trois endroits qu'elle possède (le brouillon autosauvé, les notes,
  les prompts), donc un fichier ouvert est une **entrée** dans ce flux, pas une destination.
  Réintroduire l'écriture ne coûte pas une méthode : il faudrait de nouveau mémoriser les chemins
  absolus autorisés par un dialogue natif (aucun motif ne distingue un chemin légitime de
  `C:\Windows\System32\drivers\etc\hosts`), ne pas les persister d'une exécution à l'autre, et
  restaurer le newline d'origine à l'écriture. C'était le cas jusqu'au 2026-09-04, retiré exprès.
  Un test vérifie que la classe n'a pas de méthode d'écriture ; pour garder un document ouvert, on
  l'enregistre dans les notes.
- **CodeMirror normalise toute fin de ligne en `\n` au chargement**, ce qui n'a plus de
  conséquence à l'écriture (rien n'est réécrit) mais en garde une au chargement : `replaceAll` doit
  mesurer le **texte converti**, pas la chaîne brute, sinon l'ancre tombe hors document sur du CRLF
  et la transaction est rejetée en entier (`Selection points outside of document`). C'est ce qui
  arrive en ouvrant un fichier Windows.
- **Chaque preset de réécriture interdit d'inventer du contenu** (`CORE_RULES`). Sans cette
  contrainte, le modèle fabrique des exigences absentes de l'entrée. Elle vaut pour tous les
  presets, sans exception, et un test le vérifie.
- **Aucun preset n'ajoute de section à la fin de sa sortie.** La famille `agent-prompt` a longtemps
  renvoyé les zones floues vers un `## À préciser` : supprimé le 2026-08-19, parce que la section
  tombait à chaque réécriture, y compris sur un brouillon sans ambiguïté. ⚠️ **Ne pas se contenter
  de retirer la consigne si on retouche ces prompts** : privé d'instruction, le modèle ajoute de
  lui-même un « Note : les points suivants restent flous ». `AGENT_PROMPT_RULES` et
  `REGISTER_RULES` portent donc une **interdiction explicite**, et un test la vérifie sur les deux
  familles. Le champ `kind` de `RewritePreset` ne distingue plus que la forme : `agent-prompt`
  produit du Markdown structuré pour un agent de code, `text` produit un texte lu tel quel par un
  humain (`Corriger`, `Formel`, `Chat`, `Traduire`).
- **La traduction est `text`, jamais `agent-prompt`.** Elle portait `AGENT_PROMPT_RULES`, dont le
  « use headings, bullets » restructurait un mail traduit. Les trois presets (`translate-en`,
  `translate-fr`, `translate-de`) sortent de `translationPreset()` et gardent la mise en forme telle
  quelle, le registre et la forme d'adresse. `translate-en` garde son id d'origine pour qu'un
  `defaultPresetId` ou un modèle par action déjà enregistré s'applique encore. Un test vérifie que
  chacun est `text` et ne contient pas la consigne de structure.
- **`Formel` et `Chat` changent le registre, jamais l'adresse au lecteur** (`REGISTER_RULES`). Le
  registre est une affaire de style ; le tu/vous est un fait relationnel que le brouillon ne dit
  pas. Sans interdiction, un modèle à qui on demande du soutenu bascule un texte français en
  « vous » et change silencieusement à qui l'auteur semble parler.
- **Le fournisseur est explicite et sans fallback.** `rewriteProvider` sélectionne Claude ou
  Codex pour toute réécriture ; une erreur d'un CLI est montrée, jamais masquée par un lancement
  de l'autre. Chaque fournisseur garde son propre `model` et ses `modelByPresetId` :
  `resolveModelForPreset` prend l'override du fournisseur sélectionné, sinon son défaut. Un modèle
  Codex vide est intentionnel et omet `--model`, pour laisser le CLI choisir son modèle courant.
- **Codex ne reçoit aucun contexte de projet.** L'adaptateur lance `codex exec` depuis le dossier
  du binaire avec `--ephemeral`, `--ignore-user-config`, `--sandbox read-only`,
  `--skip-git-repo-check` et `--json`. Son parser retient le dernier `agent_message` et ne conclut
  que sur `turn.completed`, `turn.failed` ou `error`. Le coordinateur commun reste seul
  responsable du timeout, de l'annulation de l'arbre de processus et de l'unique événement
  terminal.
- **Le verrou d'instance unique fait sortir l'instance perdante par `app.exit(0)`**, pas
  `app.quit()` : `quit()` est asynchrone et n'interrompt pas le script, donc l'instance condamnée
  continuait dans `bootstrap()` et ouvrait le `draft.md` et le `settings.json` que l'instance
  gagnante écrit déjà. Corollaire à connaître : le verrou est indexé sur `userData`, que tous les
  builds packagés partagent, donc **lancer une nouvelle version pendant qu'une ancienne tourne
  affiche la fenêtre de l'ancienne** sans rien signaler. D'où la version affichée en barre de
  statut.
- **La page de réglages n'applique rien avant `Enregistrer`.** Les champs écrivent dans une copie
  de travail (`structuredClone`), et `Annuler` comme `Échap` ferment sans rien appliquer, donc il
  n'y a jamais rien à défaire. Une version antérieure écrivait à chaque `change` : un raccourci
  global mal tapé était sans retour et le thème basculait pendant qu'on lisait les options.
- **Le dev tourne sur son propre `userData`** (`-dev`), défini avant `requestSingleInstanceLock`.
  Le supprimer ferait écrire les tests dans les vrais brouillons et empêcherait de lancer les
  sources quand l'app installée est ouverte.
- **Aucune mention de l'employeur, de sa charte ou d'un hub interne** dans ce dépôt : il est
  public. Les tokens de couleur restent nommés `--brand-*`.

- **Les raccourcis sont déclarés une seule fois**, dans `src/renderer/editor/shortcuts.ts`, sous
  forme de données. Le keymap CodeMirror, le `keydown` de la fenêtre, les infobulles de la barre de
  format et le panneau `F1` lisent tous ces tables. Une liste de raccourcis écrite à la main dans
  le panneau d'aide serait un document, et un document dérive : ici un binding ajouté sans libellé
  ne compile pas, et un test refuse une touche en double, un libellé vide ou un chiffre combiné à
  `Shift`. Ne pas réintroduire de touche câblée en dur ailleurs.
- **Le bouton de réécriture est un split button** (`src/renderer/ui/preset-menu.ts`), pas un
  bouton à côté d'un `<select>`. Il porte le libellé de l'action qu'il lance, et **choisir une
  entrée du menu la lance aussitôt** en plus de la sélectionner. Un `<select>` natif ne peut pas le
  faire : il ne signale qu'un changement, donc rechoisir l'entrée déjà sélectionnée ne déclenche
  rien. Le menu marque son `Escape` comme traité (`preventDefault`), sinon le `keydown` de la
  fenêtre fermerait un panneau ou masquerait la fenêtre en même temps.
- **Le badge de tokens ne s'affiche que si l'action sélectionnée est `agent-prompt`**
  (`refreshTokenBadge`). C'est un budget de prompt ; à côté d'un mail, c'est un chiffre sans
  décision attachée.
- **Le panneau d'aide (`F1`) et la page de réglages sont exclusifs**, et l'exclusion est
  asymétrique : ouvrir les réglages ferme l'aide, l'inverse est interdit. Les réglages tiennent une
  copie de travail non enregistrée, l'aide ne tient rien. C'est pourquoi `F1` est neutralisé tant
  que les réglages sont ouverts, et pourquoi le bouton `?` disparaît alors au lieu de rester inerte.

## Pièges vérifiés sur les raccourcis et le thème

Ces points ont coûté du temps à diagnostiquer, ne pas les réintroduire :

- **`Prec.highest()` sur le keymap de l'app est obligatoire.** L'ordre dans le tableau
  d'extensions ne suffit pas : `searchKeymap` réserve `Mod-Shift-l`, `Mod-d`, `Mod-f`, `Mod-g` et
  gagnait malgré une position antérieure.
- **Pas de raccourci à base de chiffre avec `Shift`.** La disposition compte : sur un clavier
  suisse romand, `Ctrl+Shift+7` arrive en `Ctrl+/` et déclenche le basculement de commentaire.
  Les chiffres sans `Shift` (`Ctrl+1..3`) sont stables.
- **`Ctrl+Shift+O` n'atteint jamais le renderer** : Chromium le garde pour ses favoris.
- **`Ctrl+,`, `Ctrl+M` et `Ctrl+L`** (réglages, notes, bibliothèque) : la virgule est non shiftée
  sur un clavier suisse romand, et aucun des trois n'est réservé par `defaultKeymap`,
  `searchKeymap` ni `historyKeymap`. ⚠️ `Ctrl+L` reste le moins sûr des trois, Chromium l'utilisant
  pour la barre d'adresse dans un vrai navigateur : à revérifier si le panneau ne s'ouvre pas.
- **`F1` plutôt qu'une combinaison `Mod-`** pour l'aide : c'est la seule touche d'aide sur laquelle
  tous les logiciels Windows s'accordent, aucune disposition ne la déforme, et ni `defaultKeymap`
  ni `searchKeymap` ne la réserve. Elle est câblée deux fois, dans le keymap **et** dans le
  `keydown` de la fenêtre, parce que l'aperçu comme le panneau d'aide lui-même n'ont aucune vue
  CodeMirror pour recevoir la touche.
- **`Ctrl+P` et `Ctrl+O`** (aperçu, ouvrir) ne passent pas par le keymap CodeMirror mais par un
  `keydown` au niveau de la fenêtre (`src/renderer/main.ts`), parce que l'aperçu remplace
  l'éditeur : quand il est affiché, le conteneur de l'éditeur est en `display:none` et le focus est
  sur le panneau d'aperçu, donc aucune vue CodeMirror ne recevrait la touche. Les deux sont
  volontairement ignorés dès que `Shift` ou `Alt` est tenu, et tant que la page de réglages est
  ouverte : ses champs texte donneraient un autre sens à un raccourci d'application.
- **L'icône des réglages est un jeu de curseurs, pas un engrenage.** Un engrenage a besoin de ses
  dents pour être lisible ; à 14px elles fusionnent et le glyphe se lit comme un astérisque.
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
npm run dist:zip   # le zip publié par la release, dans release/
```

## Release

Pousser un tag `v*` déclenche `.github/workflows/release.yml` : les portes (lint, tests,
typecheck), le build du zip, puis la publication. C'est le **seul** workflow, donc la seule porte :
une casse ne se voit qu'au moment du tag, et un échec impose de déplacer le tag plutôt que de
relancer le job, Actions résolvant le workflow depuis la référence poussée. Trois règles que le
workflow impose et qu'une modification ne doit pas casser en silence :

- **Le tag doit égaler la version de `package.json`**, sinon le job échoue tôt et volontairement.
  La barre de statut est le seul moyen de savoir quel build tourne, donc un tag qui mentirait sur
  la version rendrait cette information inutilisable.
- **Une seule release vit.** Les anciennes sont supprimées après publication de la nouvelle, dans
  cet ordre, pour qu'un échec ne laisse jamais zéro release. Les **tags sont conservés** : c'est le
  seul lien entre une version et son commit.
- **Le nom de l'asset est stable** (`oxum-prompt-editor-win-x64.zip`), imposé par
  `-c.win.artifactName` dans `dist:zip` et non par `electron-builder.yml` : le schéma
  d'electron-builder 26 refuse une clé `zip` de premier niveau, et `TargetConfiguration` n'accepte
  pas d'`artifactName` par cible. Y remettre `${version}` casserait l'URL permanente
  `releases/latest/download/oxum-prompt-editor-win-x64.zip`, qui est tout l'intérêt de n'avoir
  qu'une release.

⚠️ `test/library-store.test.ts` porte un `timeout` explicite de 30 s sur « never prunes ». Ce
n'est pas une verrue : le test écrit 300 documents et chaque `save()` reliste le dossier pour
garantir l'unicité du nom, donc le coût est quadratique. Il tient en 2 s sur un NVMe local mais
prend près de 5 s sur un runner GitHub, soit le budget par défaut de Vitest, ce qui a déjà fait
échouer une release. Ne pas le retirer, et ne pas baisser les 300 documents : le nombre doit
rester nettement au-dessus du cap de 200 de l'historique, qui est ce que le test oppose.

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
