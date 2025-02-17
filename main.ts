import {
	App,
	Plugin,
	MarkdownPostProcessor,
	MarkdownSectionInformation,
	PluginSettingTab,
	Setting,
	MarkdownView, ColorComponent, SliderComponent
} from 'obsidian';
import {ViewPlugin, ViewUpdate, EditorView, DecorationSet, Decoration} from '@codemirror/view';

interface DefinitionListPluginSettings {
	dtcolor: string;
	ddindentation: number;
}
const defaultSettings: DefinitionListPluginSettings = {
	dtcolor: '#555577',
	ddindentation: 30
}

export default class DefinitionListPlugin extends Plugin {
	private static readonly definitionMarker: RegExp = /^\n?: {3}/;
	public settings: DefinitionListPluginSettings;
	public cssElement: HTMLStyleElement;
	
	onInit() {}

	async onload() {
		console.log(`Loading plugin ${this.manifest.name} v${this.manifest.version}`);
		this.settings = Object.assign({}, defaultSettings, await this.loadData());
		this.cssElement = document.createElement('style');
		this.cssElement.textContent = `:root {
			--dtcolor: ${this.settings.dtcolor};
			--ddindentation: ${this.settings.ddindentation}px;	
		}`;
		document.head.appendChild(this.cssElement);
		this.registerEditorExtension(liveUpdateDefinitionLists);
		this.registerMarkdownPostProcessor(this.formatDefinitionLists, 99);
		this.addSettingTab(new DefinitionListSettingTab(this.app, this));
	}

	private formatDefinitionLists: MarkdownPostProcessor = function(element, context) {
		/* The post-processor is called
		 *  - when switching to Reading view: once per div that has changed
		 *  - when exporting to PDF: on the whole page div
		 *  - when the document first enters Reading view: on every child-div of page div
		 */ 
		
		/* In direct descendants of type paragraph, look for definition lists.
		 * Return as soon as possible.  */
		const paragraphs = element.findAll(':scope > p, :scope > div > p');
		let nothingToDo = true;
		for (let par of paragraphs)
			if (par.innerHTML.includes('<br>\n:   ')) {
				nothingToDo = false;
				break;
			}
		if (nothingToDo) return;
		
		return new Promise((resultCallback: (v: any) => void, errorCallback) => {		
		// TODO: some error checking
			paragraphs.forEach(par => {
				if (!par.innerHTML.includes('<br>\n:   ')) return;
			
				// create the <dl> element that is to replace the paragraph element
				const defList = document.createElement('dl');
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
						const matchDef = node.textContent.match(DefinitionListPlugin.definitionMarker);
						if (matchDef) {
							itemElement = defList.createEl('dd');
							clone.textContent = node.textContent.slice(matchDef[0].length);
						}
						else {
							itemElement = defList.createEl('dt');					
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
	
	onunload() {
		console.log(`Unloading plugin ${this.manifest.name}`);
		if (this.cssElement) this.cssElement.remove();
	}
}

/* The ViewPlugin class is generic: it requires an underlying type, a subclass of
* the PluginValue class. That is to be the first argument passed into the class method
* .fromClass() which returns a ViewPlugin instance with that underlying type.
* The second argument of that class method, to give additional details, is a PluginSpec
* instance with the same underlying type. It has zero or more of the properties eventHandlers,
* eventObservers, provide, and decorations. The latter is a function that, when passed an
* instance of the underlying class, returns a DecorationSet - in this case the function
* simply returns the .decorations instance property. */
const liveUpdateDefinitionLists = ViewPlugin.fromClass(
	class {  // the plugin is based on an anonymous class we define here
		decorations: DecorationSet;
		private readonly MARKER: string = ':   ';
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
				if (!currentLine.text.startsWith(this.MARKER) &&
					!nextLineText.startsWith(this.MARKER))
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
					currentLine.text.startsWith(this.MARKER)
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

		const previewStyle = containerEl.createEl('style', {text: `
			.example {
				margin-top: 10px;
				height: auto;
				padding: 4px;
				background-color: rgba(150, 150, 150, 0.1);
			}
			.example > dl {
				margin-block: 0;
			}
		`})
		containerEl.createEl('h2', {text: this.name});

		// The Settings items
		let colorSett: ColorComponent;
		new Setting(containerEl)
			.setName('Color of Terms')
			.setDesc('Terms in a definition list are displayed bold, in this color')
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
		let indentSett: SliderComponent;
		new Setting(containerEl)
			.setName('Indentation of Definitions')
			.setDesc('Definitions in a definition list are indented by this number of pixels')
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
						this.saveChanges(this.settings).then(console.debug);
					});
				indentSett = sl;
				}
			);
		new Setting(containerEl)
			.addButton(bt => bt.setButtonText('Reset')
				.setTooltip('Color: dark blue, #555577\nIndentation: 30 pixels')
				.onClick(evt => {
					colorSett.setValue(defaultSettings.dtcolor);
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
