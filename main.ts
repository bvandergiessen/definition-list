import { App, Plugin, MarkdownPostProcessor, MarkdownSectionInformation, PluginSettingTab, Setting } from 'obsidian';

export default class DefinitionListPlugin extends Plugin {
	private static readonly definitionMarker: RegExp = /^\n?:   /;
	
	onInit() {}

	onload() {
		console.log('Loading plugin Definition List');
		this.registerMarkdownPostProcessor(this.formatDefinitionLists, 99);
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	private formatDefinitionLists: MarkdownPostProcessor = function(element, context) {
		/* The post-processor is called
		 *  - when switching to Reading view: once per div that has changed
		 *  - when exporting to PDF: on the whole page div
		 *  - when the document first enters Reading view: on every child-div of page div
		 */ 
		
		// TODO: return a promise
		
		// Find direct descendants of type paragraph. Return as soon as possible.
		element.findAll(':scope > p').forEach(par => {
			if (!par.innerHTML.includes('<br>\n:   ')) return;
			
			// create the <dl> element that is to replace the paragraph element
			const defList = document.createElement('dl');
			let startOfLine: boolean = true;
			let itemElement: HTMLElement;
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
			element.replaceChild(defList, par);
		})
		return;
	}
	
	onunload() {
		console.log('Unloading plugin Definition List');
	}
}

class SampleSettingTab extends PluginSettingTab {
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
