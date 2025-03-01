import {
	App, Plugin, MarkdownPostProcessor, MarkdownSectionInformation,
	PluginSettingTab, Setting, MarkdownView, ColorComponent, SliderComponent,
	PluginManifest, ToggleComponent
} from 'obsidian';
import {ViewPlugin, PluginValue, ViewUpdate, EditorView, DecorationSet, Decoration} from '@codemirror/view';
import {Line, Range, RangeSet} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {SyntaxNode, Tree} from "@lezer/common";

/* Definition List plugin for Obsidian
 * ===================================
 * The plugin has four main components:
 *  1. the default export, the class DefinitionListPlugin
 *     that is instantiated once, when the plugin loads. It
 *     registers items 2, 3 and 4 so Obsidian can use them.
 *  2. the constant liveUpdateDefinitionLists, an instance
 *     of the ViewPlugin class.
 *  2a. It instantiates a DocumentDecorationEngine for every
 *     open (active, loaded) document, i.e. a document has its
 *     own DocumentDecorationEngine that formats its Definition
 *     lists when it's in Edit Mode and Source Mode. Its .update
 *     method is called in Edit Mode whenever anything happens -
 *     first rendering, edits, scrolling; it tells the editor
 *     CodeMirror to add 'decorations' (classes  and spans) to
 *     the DOM so it takes on the correct appearance.
 *  3. the function postProcessDefinitionLists, which adheres to the
 *     MarkdownPostProcessor interface. When a document enters
 *     Reading View, this function is called on every paragraph
 *     changed since the last time in Reading View. It's called
 *     once when the document is saved as a PDF.
 *  4. the class DefinitionListSettingTab, that is instantiated
 *     once, when the plugin loads. It sets up the settings page
 *     and saves changed settings.
 */

interface blockOfLines {
	firstLine: number,
	special: boolean,
	defMarker: boolean,
	listLines: number[]
}
type lineType = 'blockStart' | 'blockEnd' | 'block' | 'contiguousBlock' | 'listItem' | 'normal';
interface DefinitionListPluginSettings {
	dtcolor: string;
	dtbold: boolean;
	dtitalic: boolean;
	ddindentation: number;
}
const defaultSettings: DefinitionListPluginSettings = {
	dtcolor: '#555577',
	dtbold: true,
	dtitalic: false,
	ddindentation: 30
}
const definitionMarker: RegExp = /(?:^|\n): {3}/;
const MARKER: string = ':   ';
const MARKER_LEN: number = MARKER.length;

/* 1. The main class, instantiated by Obsidian when the plugin loads */
export default class DefinitionListPlugin extends Plugin {
	public settings: DefinitionListPluginSettings;
	public readonly cssElement: HTMLStyleElement = document.createElement('style');

	async onload() {
		console.log(`Loading plugin ${this.manifest.name} v${this.manifest.version}`);
		this.settings = Object.assign({}, defaultSettings, await this.loadData());
		this.cssElement.textContent = `:root {
			--dtcolor: ${this.settings.dtcolor};
			--dtweight: ${this.settings.dtbold ? 'bold' : 'inherit'};
			--dtstyle: ${this.settings.dtitalic ? 'italic' : 'inherit'};
			--ddindentation: ${this.settings.ddindentation}px;	
		}`;
		document.head.appendChild(this.cssElement);
		this.registerEditorExtension(liveUpdateDefinitionLists);
		this.registerMarkdownPostProcessor(postProcessDefinitionLists, 99);
		this.addSettingTab(new DefinitionListSettingTab(this.app, this));
	}

	onunload() {
		console.log(`Unloading plugin ${this.manifest.name}`);
		if (this.cssElement) this.cssElement.remove();
	}
}

/* 2a.The DocumentDecorationEngine class: a document's live updater */
/**
 * An open (active) document's manager for its **Definition list** decorations.
 * Keeps track of the decorations and updates them when needed.
 */
class DocumentDecorationEngine implements PluginValue {
	/**
	 * The decorations of one document in the editor.
	 * Its type, `DecorationSet`, is a RangeSet of items of the underlying type Decoration.
	 * It behaves as immutable! You use its methods not to change it in-place, but to
	 * return a new DecorationSet with different properties, which you then re-assign
     * to the `this.decorations` variable. A RangeSet object has properties and methods
     * _.size_ (number of elements); _.iter()_ with optional arg `from`, an offset that
     * lies in or before the first to be iterated; _.update(RangeSetUpdate)_ to add
     * or remove them (returns the new version); _.between(from, to, func)_ to run `func`
     * on every Decoration between the offsets `from` and `to`; _.map(ChangeDesc)_.
	 */
	decorations: DecorationSet;
	private readonly TERM_CLASS: string = 'view-dt';
	private readonly DEF_CLASS: string = 'view-dd';
	private readonly DD_LIST_CLASS: string = 'view-dd-li';
	private readonly MARKER_CLASS: string = 'view-dd-marker';
	private readonly TERM_DEC: Decoration = Decoration.line({class: this.TERM_CLASS});
	private readonly DEF_DEC: Decoration = Decoration.line({class: this.DEF_CLASS});
	private readonly DD_LIST_DEC: Decoration = Decoration.line({class: this.DD_LIST_CLASS});
	private readonly MARKER_DEC: Decoration = Decoration.mark({class: this.MARKER_CLASS});
	private readonly BLOCK_START_TYPES: number[] = [10 /* code */, 17 /* formula */];
	private readonly BLOCK_INNER_TYPES: number[] = [11 /* code */, 18 /* formula */];
	private readonly BLOCK_END_TYPES: number[] = [13 /* code */, 22 /* formula */];
	private readonly CONTIGUOUS_BLOCK_TYPES: number[] = [41, 38, 8, 44, 47, 50 /* headers 1-6 */,
		55 /* table */, 129 /* blockquote */, 158 /* image */, 86 /* horizontal line */];
		// special blocks that don't have start and end lines
	private readonly LIST_TYPES: number[] = [16, 28, 32, 35, 70, 14, 26, 30, 34, 152];
	private never_updated: boolean = true;
	private numberOfLines: number = 1;
	private readonly lineBlocks: blockOfLines[] = [];

	constructor(view: EditorView) {
		this.decorations = Decoration.none;
		console.debug(`live updater for ${view.state.doc.line(1).text} started`);
	}

	/* the boolean ViewUpdate properties that may be useful:
     *  .viewportChanged: anything that may affect the viewport or visible ranges.
     *     This includes single-character edits! Thus, at best a general filter
     *  .viewportMoved: actual scrolling over significant distance; probably
     *     has made some invisible ranges visible so they may need to be decorated
     *  .docChanged: some edit to the document - normally a single character
     *  .geometryChanged: editor size, or the document itself, changed
     *  .focusChanged: maybe some switch to another document, panel etc.;
     *  change in View between Editing and Rendering view; but
     *  when the document/Editing is activated, .geometryChanged is also true.
     * There's no property that indicates "change of overall structure" (e.g.
     * a new code block or table).
     * One change from Reading to Editing view triggered at one time:
     * viewportChanged, viewportMoved, heightChanged, geometryChanged; then
     * heightChanged, geometryChanged; then focusChanged; then heightChanged
     * and geometryChanged twice. Some debouncing may be in order.
     * Launching Obsidian with a document open: lots and lots; viewportChanged once.
     * Switching to an open doc for the first time after restart: instantiates
     * this class => use the constructor for this
     */
	update(update: ViewUpdate) {
		// for (let u of ['selectionSet', 'docChanged', 'geometryChanged', 'focusChanged',
		// 	'heightChanged', 'viewportMoved', 'viewportChanged'])
		// 	if ((update as any)[u])
		// 		console.debug(u);

		if (!update.viewportChanged && !this.never_updated) {
			return;
		}
		// console.debug(new Date().toTimeString());

		/* Big scroll => whole DecorationSet from scratch; perhaps some of it can be
         * de-duplicated? Also runs the first time Edit View is active. */
		if (update.viewportMoved ||
			(this.never_updated && update.view.contentDOM.isShown())) {
			console.debug(update.viewportChanged ? 'viewportMoved' : 'first update');
			return this.decorateVisibleRangesFromScratch(update);
		}
		if (update.docChanged) {
			console.debug('docChanged');
			// update.changes.iterChanges(console.debug, true);
			return this.adjustDecorationsAfterEdit(update);
		}
		// TODO: requestMeasure to set CSS for first-line indent
	}

	decorateVisibleRangesFromScratch(update: ViewUpdate) {
		const docText = update.state.doc;
		this.numberOfLines = docText.lines;
		const tree: Tree = syntaxTree(update.state);  // to check line types
		// console.debug(tree);
		this.lineBlocks.splice(0);
		let currentBlock: blockOfLines;
		let lnr: number;
		let inContiguousBlock: boolean = false;
		for (let range of update.view.visibleRanges) {
			/* multiple ranges are always in document order, but the border
			 * between them may fall within a line. NB A range border
			 * may fall inside special blocks (code, table, formula)! */
			// console.debug('Range:', range);
			lnr = docText.lineAt(range.from).number;
			if (this.lineBlocks.length)
				currentBlock = this.lineBlocks.last();
			else {
				currentBlock = {firstLine: lnr, special: false, defMarker: false, listLines: []};
				this.lineBlocks.push(currentBlock);
			}

			/* 1. Find and record the locations of block boundaries
			 * 2. Record which of the blocks are special (header etc.) and which
			 *    have a definition marker somewhere inside. */
			for (; lnr <= docText.lineAt(range.to).number; lnr++) {
				const line: Line = docText.line(lnr);
				const lineType: lineType = this.lineType(line.from, tree);
				// console.debug(`${lnr}: ${lineType}`);
				switch (lineType) {
					case 'blockStart':
						if (currentBlock.firstLine !== lnr) {
							currentBlock = {
								firstLine: lnr, special: true, defMarker: false, listLines: []}
							;
							this.lineBlocks.push(currentBlock);
						} else
							currentBlock.special = true;
						break;
					case 'blockEnd':
						currentBlock.special = true;
						currentBlock = {
							firstLine: lnr + 1, special: false, defMarker: false, listLines: []
						};
						this.lineBlocks.push(currentBlock);
						break;
					case 'block':
						currentBlock.special = true;
						break;
					case 'contiguousBlock':
						if (!inContiguousBlock) {
							inContiguousBlock = true;
							if (currentBlock.firstLine !== lnr) {   // set up a new block
								currentBlock = {
									firstLine: lnr, special: true, defMarker: false, listLines: []
								};
								this.lineBlocks.push(currentBlock);
							}
							else
								currentBlock.special = true;
						}
						break;
					case 'normal':
					case 'listItem':
						// we may still be inside a special block
						if (inContiguousBlock || (!currentBlock.special && !line.length)) {
							// either we're just coming out of a table, a header, etc.,
							// or there's an empty non-special line. Start a new block
							if (currentBlock.firstLine !== lnr) {
								currentBlock = {
									firstLine: lnr, special: false, defMarker: false, listLines: []
								};
								this.lineBlocks.push(currentBlock);
							}
							inContiguousBlock = false;
						}
						if (line.text.startsWith(MARKER))
							currentBlock.defMarker = true;
						else if (lineType === 'listItem')
							currentBlock.listLines.push(lnr);
				}
			}
		}
		// console.debug(lnr, this.lineBlocks);

		/* 3. Go through each definition-list block and set the formatting of every line. */
		const newDecorations: Range<Decoration>[] = [];
		for (let i = 0; i < this.lineBlocks.length; i++) {
			if (this.lineBlocks[i].special || !this.lineBlocks[i].defMarker)
				continue;  // not a definition list
			let startline: number = this.lineBlocks[i].firstLine;
			let endline: number = i == this.lineBlocks.length - 1 ? lnr : this.lineBlocks[i+1].firstLine;
			for (let n = startline; n < endline; n++) {
				const line: Line = docText.line(n);
				if (line.text.startsWith(MARKER))
					newDecorations.push(
						this.DEF_DEC.range(line.from), // linedec anchored on start
						this.MARKER_DEC.range(line.from, line.from + MARKER_LEN)
					)
				else if (this.lineBlocks[i].listLines.includes(n))
					newDecorations.push(this.DD_LIST_DEC.range(line.from));
				else if (line.length)
					newDecorations.push(this.TERM_DEC.range(line.from));
				// empty lines get no decoration
			}
		}
		// console.debug(newDecorations);
		/* the argument for .update is of class RangeSetUpdate<Decoration>,
		* and RangeSetUpdate is a typedef of an Object with optional
		* property .add of class readonly Range<Decoration>; that in turn has
		* instance properties from, to, and the Decoration.
		* You can create a Range<Decoration> by creating a Decoration and
		* applying its .range method (inherited from its superclass RangeValue). */
		this.decorations = RangeSet.of(newDecorations);
		this.never_updated = false;
	}

	/* docChanged is usually simple: the .map method updates all offsets
     * beyond the insertion or deletion. But it gets complicated when the
     * edit happens inside a marker or creates one. */
	adjustDecorationsAfterEdit(update: ViewUpdate) {
		// Shift {from, to} of existing decorations in accordance with edit
		this.decorations = this.decorations.map(update.changes);

		/* Do a full re-parsing if the edit CHANGED THE BLOCK STRUCTURE
         * of the document, by
         * - changing the total number of lines (or should we be more lenient with this?)
         * - emptying a line, or inserting text on an empty line
         * - turning a normal block into a special block, or the reverse
         * - turning a normal block into a definition list, or the reverse */
		// Changed total number of lines:
		if (update.state.doc.lines !== this.numberOfLines)
			return this.decorateVisibleRangesFromScratch(update);
		// this boolean gathers all requests for a complete update, to do it just once
		let fullRedecorationRequired: boolean = false;
		update.changes.iterChangedRanges((f0, t0, f1, t1) => {
			if (fullRedecorationRequired)
				return;  // no need to investigate anything: we've already decided
			const line: Line = update.state.doc.lineAt(f1);
			if (line.from + MARKER_LEN <= Math.min(f0, f1))
				return;  // the edit took place outside the marker area
			// Line emptied, or empty line filled:
			if ((f0 === t0) !== (f1 === t1))  {
				fullRedecorationRequired = true;
				return;
			}
			for (var i= this.lineBlocks.length - 1; i >= 0; i--)
				if (this.lineBlocks[i].firstLine <= line.number)
					break;
			const currentBlock: blockOfLines = this.lineBlocks[i];
			// Turned normal block into special block, or the reverse:

			// TODO: do we really want to go into the tree to get this? Or shall we wait for
			//  a newline to be inserted etc.?

			// Turned normal block into definition list, or (potentially) the reverse:
			if (!currentBlock.special && currentBlock.defMarker !== line.text.startsWith(MARKER)) {
				fullRedecorationRequired = true;
				return;
				// TODO: check whether this was never a marker-line to begin with. If
				//  we're writing the next term, we don't want 4 full updates
			}

			/* Now that we have decided against a full re-decoration, let's
			 * see whether we need to redecorate the current block:
			 * terms turned into list items or the other way around. */

		})
		if (fullRedecorationRequired)
			this.decorateVisibleRangesFromScratch(update);
	}

	lineType(pos: number, tree: Tree): lineType {
		// check whether the position lies within a code block, table, formula block
		/* Note that the syntaxTree is a lot "flatter" than you'd expect: a
		 * code block is not one node with subnodes but a bunch of consecutive
		 * nodes in the tree. So the real syntax TREE is hidden from us. */
		let node = tree.resolveStack(pos, 1);
		while (node) {
			// console.debug(node.node?.name, node.node?.type?.id);
			if (node.node?.type?.id === 1)
				return 'normal';
			if (this.BLOCK_START_TYPES.includes(node.node.type.id))
				return 'blockStart';
			if (this.BLOCK_INNER_TYPES.includes(node.node.type.id))
				return 'block';
			if (this.BLOCK_END_TYPES.includes(node.node.type.id))
				return 'blockEnd';
			if (this.CONTIGUOUS_BLOCK_TYPES.includes(node.node.type.id))
				return 'contiguousBlock';
			if (this.LIST_TYPES.includes(node.node.type.id))
				return 'listItem';
			node = node.next;
		}

		/*const el = node.parentElement as HTMLElement;
		const cls: DOMTokenList | undefined = el.closest('.cm-line')?.classList;
		if (cls)
			return cls.contains('HyperMD-codeblock');
		if (el.closest('.cm-embed-block') || el.closest('table'))
			// .cm-embed-block and .math are on elements that are siblings of the math source lines
			return true;
		return false;*/
	}
}

/* 2. The ViewPlugin that works in Edit Mode. */
const liveUpdateDefinitionLists: ViewPlugin<DocumentDecorationEngine> = ViewPlugin.fromClass(
	DocumentDecorationEngine, {decorations: dde => dde.decorations}
);
/* The ViewPlugin class requires an embedded type that adheres to the
 * PluginValue interface. the class method .fromClass() returns a
 * ViewPlugin instance with that embedded type.
 * The first argument passed into .fromClass is the embedded class.
 * The second argument is a PluginSpec instance built on the same type.
 * It has zero or more of the properties eventHandlers, eventObservers,
 * provide, and decorations.
 * The value of .decorations is a function that, when passed an instance
 * of the embedded class, returns a DecorationSet - in this case the function
 * simply returns the .decorations instance property. */

/* 3. The MarkdownPostProcessor that prepares Reading View and PDF export. */
const postProcessDefinitionLists: MarkdownPostProcessor = function(element, context): Promise<null>|undefined {
	/* This post-processor is called
     *  - when the document first enters Reading view: on every child-div of page div
     *  - when switching to Reading view: once per div that has changed
     *  - when exporting to PDF: on the whole page div */

	// console.debug(element.outerHTML);

	/* In Reading View, the element passed in IS a single <div>;
	 * in PDF output, it is the PARENT ELEMENT of all the <div>s.
	 * First check if the element has class 'el-p' (Reading-view paragraph)
	 * or 'markdown-rendered' (PDF-output root element).
     * If neither, return immediately.  */
	if (!element.classList.contains('el-p') &&
		!element.classList.contains('el-ul') &&
		!element.classList.contains('el-ol') &&
		!element.classList.contains('markdown-rendered'))
		return;

	// it's one paragraph (in Reading View), or the whole document (PDF)
	let preChecked: boolean = false;
	if (element.classList.contains('el-p')) { // Reading View paragraph
		if (!element.firstElementChild.innerHTML.match(definitionMarker))
			return;
		// console.debug('Now we will create the modified paragraph:');
		// console.debug(element.textContent);
		preChecked = true;
	}
	if (element.classList.contains('el-ul') || element.classList.contains('el-ol')) { // list. Is there a <dd> at the end?
		if (!element.firstElementChild.lastElementChild.innerHTML.contains('\n'))
			return;
		const originalHTML: string = element.firstElementChild.lastElementChild
			.innerHTML;
		const newlinePos: number = originalHTML.indexOf('\n');
		element.firstElementChild.lastElementChild.innerHTML =
			originalHTML.slice(0, newlinePos);
		element.appendChild(document.createElement('p')).innerHTML =
			originalHTML.slice(newlinePos+1);
		preChecked = true;
	}

	/* This Promise gets no content; the only use of its fulfillment
	 * is to signal to the receiving process that we're done
	 * editing its DOM */
	return new Promise((resultCallback: (v: any) => void) => {
		let paragraphs: HTMLParagraphElement[];
		if (preChecked)
			paragraphs = [element.lastElementChild as HTMLParagraphElement];
		else
			paragraphs = element.findAll(':scope > div > p') as HTMLParagraphElement[];

		paragraphs.forEach((par: HTMLParagraphElement) => {
			if (!preChecked && !par.innerHTML.match(definitionMarker)) return;

			// create the <dl> element that is to replace the paragraph element
			const defList: HTMLDListElement = document.createElement('dl');
			let startOfLine: boolean = true;
			let itemElement: HTMLElement;

			// fill the new <dl> with clones of the nodes in the original <p>
			par.childNodes.forEach(node => {
				if ('tagName' in node && node.tagName === "BR") {
					startOfLine = true;
					return;
				}
				const clone = node.cloneNode(true);
				if (startOfLine) {
					if (node.textContent.match(definitionMarker)) {
						itemElement = defList.createEl('dd');
						clone.textContent = node.textContent.slice(4);
					}
					else if (node.textContent.length <= 100) {
						// a term can't reasonably be longer than 100 chars
						itemElement = defList.createEl('dt');
					}
					else {
						itemElement = defList.createEl('p');
					}
					startOfLine = false;
				}
				itemElement.append(clone);
			})

			// put the <dl> in place of the <p>
			par.replaceWith(defList);
		})
		resultCallback(null);
	})
}

/* 4. The PluginSettingTab for this plugin's settings. */
class DefinitionListSettingTab extends PluginSettingTab {
	private readonly name: string;
	private readonly settings: DefinitionListPluginSettings;
	private readonly cssElement: HTMLStyleElement;
	private readonly saveChanges: (data: any) => Promise<void>;
	constructor(app: App, plugin: DefinitionListPlugin) {
		super(app, plugin);
		this.name = plugin.manifest.name;
		this.settings = plugin.settings;
		this.cssElement = plugin.cssElement;
		this.saveChanges = plugin.saveData.bind(plugin);
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();
		containerEl.createEl('style', {text: `
			.mod-toggle {
				border-top: none;
			}
			.example {
				margin-top: 10px;
				height: auto;
				padding: 4px;
				background-color: rgba(150, 150, 150, 0.1);
			}
			.example > dl {
				margin-block: 0;
			}
		`});
		containerEl.createEl('h2', {text: this.name});

		// The Settings items
		let colorSett: ColorComponent;
		new Setting(containerEl)
			.setName('Terms')
			.setDesc('Font color')
			.addColorPicker(cp => {
				cp.setValue(this.settings.dtcolor)
					.onChange(newColor => {
						console.debug('color set to', newColor);
						this.settings.dtcolor = newColor;
						this.cssElement.sheet.insertRule(`:root {
							--dtcolor: ${newColor};
						}`, this.cssElement.sheet.cssRules.length);
						this.saveChanges(this.settings);
					});
				colorSett = cp;
				}
			);
		let weightSett: ToggleComponent;
		new Setting(containerEl)
			.setDesc('Bold font')
			.addToggle(tog => {
				tog.setValue(this.settings.dtbold)
				.onChange(newWeight => {
					console.debug('bold set to', newWeight);
					this.settings.dtbold = newWeight;
					this.cssElement.sheet.insertRule(`:root {
						--dtweight: ${newWeight ? 'bold' : 'inherit'
					}`, this.cssElement.sheet.cssRules.length);
					this.saveChanges(this.settings);
				})
				weightSett = tog;
			});
		let styleSett: ToggleComponent;
		new Setting(containerEl)
			.setDesc('Italic font')
			.addToggle(tog => {
				tog.setValue(this.settings.dtitalic)
					.onChange(newStyle => {
						console.debug('italic set to', newStyle);
						this.settings.dtitalic = newStyle;
						this.cssElement.sheet.insertRule(`:root {
						--dtstyle: ${newStyle ? 'italic' : 'inherit'
						}`, this.cssElement.sheet.cssRules.length);
						this.saveChanges(this.settings);
					})
				styleSett = tog;
			});
		let indentSett: SliderComponent;
		new Setting(containerEl)
			.setName('Definitions')
			.setDesc('Indentation of the definitions')
			.addSlider(sl => {
				sl.setLimits(0, 50, 1)
					.setValue(this.settings.ddindentation)
					.setDynamicTooltip()
					.onChange(value => {
						console.debug('indentation set to', value, 'px');
						this.settings.ddindentation = value;
						this.cssElement.sheet.insertRule(`:root {
							--ddindentation: ${value}px;
						}`, this.cssElement.sheet.cssRules.length);
						this.saveChanges(this.settings);
					});
				indentSett = sl;
				}
			);
		new Setting(containerEl)
			.addButton(bt => bt.setButtonText('Reset to defaults')
				.setTooltip('Color: dark blue, #555577\nIndentation: 30 pixels')
				.onClick(evt => {
					colorSett.setValue(defaultSettings.dtcolor);
					weightSett.setValue(defaultSettings.dtbold);
					styleSett.setValue(defaultSettings.dtitalic);
					indentSett.setValue(defaultSettings.ddindentation);
				})
			);

		// The preview that shows how the settings work out
		containerEl.createEl('div', {cls: 'setting-item-name', text: 'Preview'});
		containerEl.createEl('div', {cls: 'example markdown-preview-view'})
		.innerHTML = `
			<dl>
			<dt>definition list</dt>
			<dd>a list of pairs <i>(term, definition)</i> where each
			term is on its own line and its definition is on the line(s) below.
			The definition is usually indented to set it apart from the term</dd>
			<dt>indentation</dt>
			<dd>when a line or paragraph starts at a distance from the left margin</dd>
			</dl>
		`;
	}
}
