import {
	App,
	Plugin,
	MarkdownPostProcessor,
	MarkdownSectionInformation,
	PluginSettingTab,
	Setting,
	MarkdownView
} from 'obsidian';
import {ViewPlugin, ViewUpdate, EditorView, DecorationSet, Decoration} from '@codemirror/view';

export default class DefinitionListPlugin extends Plugin {
	private static readonly definitionMarker: RegExp = /^\n?:   /;
	
	onInit() {}

	onload() {
		console.log(`Loading plugin Definition List v${this.manifest.version}`);
		this.registerMarkdownPostProcessor(this.formatDefinitionLists, 99);
		this.addSettingTab(new DefinitionListSettingTab(this.app, this));
		this.registerEditorExtension(liveUpdateDefinitionLists);
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
		console.log('Unloading plugin Definition List');
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
		private readonly TERM_CLASS: string = 'view-dt';
		private readonly DEF_CLASS: string = 'view-dd';
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
				if (!currentLine.text.startsWith(':   ') && !nextLineText.startsWith(':   '))
					return;

				// TODO: two terms before one definition
				// TODO: put : and first spaces in a separate div or so
				//  and then in CSS say div:not(.cm-active)>.leading-chars {display: none;}
				// TODO: parse all definition lists when first opening Edit View, or at
				//  least those inside the viewport
				// TODO: implement removal of class when it's not a DL anymore after an edit

				// Perform a few checks before adding any classes
				const lineClasses =  update.view.domAtPos(cursorPos)	.node.parentElement.closest('.cm-line')?.classList ||
					{contains: (s: string) => false};
				// No definition lists inside a code block
				if (lineClasses.contains('HyperMD-codeblock'))
					return;
				// Don't add a class when it's already been done
				if (lineClasses.contains(this.DEF_CLASS) ||
					lineClasses.contains(this.TERM_CLASS))
					return;

				// Finally, as all criteria have been met, we get to work
				const lineclass: string =
					(currentLine.text.startsWith(':   ')) ? this.DEF_CLASS : this.TERM_CLASS;
				this.decorations = this.decorations.update({add: [Decoration
						.line({class: lineclass})
						.range(currentLine.from)]});  // line decorations are 0-length
				/* the argument for .update is of class RangeSetUpdate<Decoration>,
				* and RangeSetUpdate is a typedef of an Object with optional
				* property .add of class readonly Range<Decoration>; that in turn has
				* instance properties from, to, and the Decoration.
				* You can create a Range<Decoration> by creating a Decoration and
				* applying its .range method (inherited from its superclass RangeValue).
				* Note that .update doesn't modify the instance but returns it. */
			}
			// if (update.viewportChanged) console.log('viewport changed');
			// if (update.geometryChanged) console.log('geometry changed');
		}
	},
	{
		decorations: v => v.decorations,
	}
);

class DefinitionListSettingTab extends PluginSettingTab {
	display(): void {
		let {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Settings for my awesome plugin.'});

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text.setPlaceholder('Enter your secret')
				.setValue('')
				.onChange((value) => {
					console.log('Secret: ' + value);
				}));

	}
}
