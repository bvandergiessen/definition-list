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

const liveUpdateDefinitionLists = ViewPlugin.fromClass(
	class {  // the plugin is based on an anonymous class we define here
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = Decoration.none;
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.selectionSet) {
				const state = update.view.state;
				const cursorPos = state.selection.main.head;

				// the Line object that represents the current line of the document
				// note that state.doc is an object of class Text
				const currentLine = state.doc.lineAt(cursorPos);
				// the text of the following line
				const nextLineText: string = (state.doc.lines === currentLine.number) ? '' :
					state.doc.line(currentLine.number + 1).text;
				if (!currentLine.text.startsWith(':') && !nextLineText.startsWith(':'))
					return;
				const lineclass: string = (currentLine.text.startsWith(':')) ? 'view-dd' : 'view-dt';
				this.decorations = Decoration.set([Decoration.line({class: lineclass}).range(currentLine.from)]);
			}
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
