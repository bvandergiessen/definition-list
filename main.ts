import {
	App, Plugin, MarkdownPostProcessor, MarkdownSectionInformation,
	PluginSettingTab, Setting, MarkdownView, ColorComponent, SliderComponent,
	PluginManifest, ToggleComponent
} from 'obsidian';
import {ViewPlugin, ViewUpdate, EditorView, DecorationSet, Decoration} from '@codemirror/view';

/* Definition List plugin for Obsidian
 * ===================================
 * The plugin has four main components:
 *  1. the default export, the class DefinitionListPlugin
 *     that is instantiated once, when the plugin loads. It
 *     registers items 2, 3 and 4 so Obsidian can use them.
 *  2. the constant liveUpdateDefinitionLists, an instance
 *     of the ViewPlugin class. Inside it, an anonymous class
 *     is embedded that is instantiated when a document is
 *     opened (or the first time the user switches to it): every
 *     open document has its own instance of that embedded class.
 *     Its .update method is called in Edit Mode whenever anything
 *     happens - edits, scrolling, cursor movement - with contents
 *     and details of the document and editor window passed in;
 *     it tells the editor CodeMirror to add 'decorations' (classes
 *     and spans) to the content, so it takes on the correct appearance
 *  3. the function postProcessDefinitionLists, which adheres to the
 *     MarkdownPostProcessor interface. When a document enters
 *     Reading View, this function is called on every paragraph
 *     changed since the last time in Reading View. It's called
 *     once when the document is saved as a PDF.
 *  4. the class DefinitionListSettingTab, that is instantiated
 *     once, when the plugin loads. It sets up the settings page
 *     and saves changed settings.
 */

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

/* 2. The ViewPlugin that works in Edit Mode. */
const liveUpdateDefinitionLists = ViewPlugin.fromClass(
	/* The ViewPlugin class is generic: it requires an underlying type, a subclass of
     * the PluginValue class. That is to be the first argument passed into the class
     * method .fromClass() which returns a ViewPlugin instance with that underlying
     * type. The second argument of that class method, to give additional details,
     * is a PluginSpec instance with the same underlying type. It has zero or more
     * of the properties eventHandlers, eventObservers, provide, and decorations.
     * The latter is a function that, when passed an instance of the underlying
     * class, returns a DecorationSet - in this case the function simply returns
     * the .decorations instance property. */
	class {  // the plugin embeds an anonymous class we define here
		decorations: DecorationSet;
		private readonly TERM_CLASS: string = 'view-dt';
		private readonly DEF_CLASS: string = 'view-dd';
		private readonly MARKER_CLASS: string = 'view-dd-marker';
		private readonly TERM_DEC: Decoration = Decoration.line({class: this.TERM_CLASS});
		private readonly DEF_DEC: Decoration = Decoration.line({class: this.DEF_CLASS});
		private readonly MARKER_DEC: Decoration = Decoration.mark({class: this.MARKER_CLASS});
		constructor(view: EditorView) {
			this.decorations = Decoration.none;
		}
		/* this.decorations should be a cumulative array of all the decorations (i.e.
		* class changes) we have chosen to add to line elements. So we always add to it
		* or modify an existing entry, rather than instantiating it anew.
		* Note that its type, DecorationSet, is a RangeSet of items of the underlying
		* type Decoration. Such a RangeSet object has properties and methods
		* .size (number of elements); .iter() with optional arg from, an offset that
		* lies in or before the first to be iterated; .update(RangeSetUpdate) to add
		* or remove them (returns the new version); .between(from, to, func) run func
		* on every Decoration between the offsets from and to; .map(ChangeDesc). */

		update(update: ViewUpdate) {
			if (update.docChanged || update.selectionSet)
				/* other boolean properties that may be useful:
                *  .viewportChanged: viewport or visible ranges have changed
                *  .geometryChanged: editor size or the document itself changed
                *  .focusChanged: maybe some switch to another document, panel etc.;
                *  change in View between Editing and Rendering view; but
                *  when the document/Editing is activated, .geometryChanged is also true.
                */
			{
				const state = update.view.state;
				const cursorPos = state.selection.main.head;

				// the Line object that represents the current line of the document
				// note that state.doc is an object of class Text
				const currentLine = state.doc.lineAt(cursorPos);
				// the text of the following line
				const nextLineText: string = (state.doc.lines === currentLine.number) ? '' :
					state.doc.line(currentLine.number + 1).text;
				if (!currentLine.text.startsWith(MARKER) &&
					!nextLineText.startsWith(MARKER))
					return;

				// TODO: two terms before one definition
				// TODO: parse all definition lists when first opening Edit View, or at
				//  least those inside the viewport (+ update if update.viewportChanged)
				// TODO: implement removal of class when it's not a DL anymore after an edit
				// FIXME: empty <dt> keeps getting additional decorations

				// Perform a few checks before adding any decorations
				const lineClasses =  update.view
						.domAtPos(cursorPos).node.parentElement.closest('.cm-line')?.classList
					|| {contains: (s: string) => false};
				// - No definition lists inside a code block
				if (lineClasses.contains('HyperMD-codeblock'))
					return;
				// - Don't add a class when it's already been done
				if (lineClasses.contains(this.DEF_CLASS) ||
					lineClasses.contains(this.TERM_CLASS))
					return;

				// Finally, as all criteria have been met, we get to work
				const newDecorations =
					currentLine.text.startsWith(MARKER)
						? [
							this.DEF_DEC.range(currentLine.from), // linedec anchored on start
							this.MARKER_DEC.range(currentLine.from, currentLine.from+4)
						] : [
							this.TERM_DEC.range(currentLine.from)
						];
				this.decorations = this.decorations.update({add: newDecorations});
				console.debug(this.decorations.size, 'decorations');
				/* the argument for .update is of class RangeSetUpdate<Decoration>,
				* and RangeSetUpdate is a typedef of an Object with optional
				* property .add of class readonly Range<Decoration>; that in turn has
				* instance properties from, to, and the Decoration.
				* You can create a Range<Decoration> by creating a Decoration and
				* applying its .range method (inherited from its superclass RangeValue).
				* Note that .update doesn't modify the instance but returns it. */
			}
			// else if (update.viewportChanged) console.log('viewport changed');
			// else if (update.geometryChanged) console.log('geometry changed');
		}
	},
	{
		decorations: v => v.decorations,
	}
);

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
