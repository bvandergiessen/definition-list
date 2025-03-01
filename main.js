'use strict';

var obsidian = require('obsidian');
var view = require('@codemirror/view');
var state = require('@codemirror/state');
var language = require('@codemirror/language');

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */

function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

const defaultSettings = {
    dtcolor: '#555577',
    dtbold: true,
    dtitalic: false,
    ddindentation: 30
};
const definitionMarker = /(?:^|\n): {3}/;
const MARKER = ':   ';
const MARKER_LEN = MARKER.length;
class DefinitionListPlugin extends obsidian.Plugin {
    constructor() {
        super(...arguments);
        this.cssElement = document.createElement('style');
    }
    onload() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log(`Loading plugin ${this.manifest.name} v${this.manifest.version}`);
            this.settings = Object.assign({}, defaultSettings, yield this.loadData());
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
        });
    }
    onunload() {
        console.log(`Unloading plugin ${this.manifest.name}`);
        if (this.cssElement)
            this.cssElement.remove();
    }
}
class DocumentDecorationEngine {
    constructor(view$1) {
        this.TERM_CLASS = 'view-dt';
        this.DEF_CLASS = 'view-dd';
        this.DD_LIST_CLASS = 'view-dd-li';
        this.MARKER_CLASS = 'view-dd-marker';
        this.TERM_DEC = view.Decoration.line({ class: this.TERM_CLASS });
        this.DEF_DEC = view.Decoration.line({ class: this.DEF_CLASS });
        this.DD_LIST_DEC = view.Decoration.line({ class: this.DD_LIST_CLASS });
        this.MARKER_DEC = view.Decoration.mark({ class: this.MARKER_CLASS });
        this.BLOCK_START_TYPES = [10, 17];
        this.BLOCK_INNER_TYPES = [11, 18];
        this.BLOCK_END_TYPES = [13, 22];
        this.CONTIGUOUS_BLOCK_TYPES = [41, 38, 8, 44, 47, 50,
            55, 129, 158, 86];
        this.LIST_TYPES = [16, 28, 32, 35, 70, 14, 26, 30, 34, 152];
        this.never_updated = true;
        this.numberOfLines = 1;
        this.lineBlocks = [];
        this.decorations = view.Decoration.none;
        console.debug(`live updater for ${view$1.state.doc.line(1).text} started`);
    }
    update(update) {
        if (!update.viewportChanged && !this.never_updated) {
            return;
        }
        if (update.viewportMoved ||
            (this.never_updated && update.view.contentDOM.isShown())) {
            console.debug(update.viewportChanged ? 'viewportMoved' : 'first update');
            return this.decorateVisibleRangesFromScratch(update);
        }
        if (update.docChanged) {
            console.debug('docChanged');
            return this.adjustDecorationsAfterEdit(update);
        }
    }
    decorateVisibleRangesFromScratch(update) {
        const docText = update.state.doc;
        this.numberOfLines = docText.lines;
        const tree = language.syntaxTree(update.state);
        this.lineBlocks.splice(0);
        let currentBlock;
        let lnr;
        let inContiguousBlock = false;
        for (let range of update.view.visibleRanges) {
            lnr = docText.lineAt(range.from).number;
            if (this.lineBlocks.length)
                currentBlock = this.lineBlocks.last();
            else {
                currentBlock = { firstLine: lnr, special: false, defMarker: false, listLines: [] };
                this.lineBlocks.push(currentBlock);
            }
            for (; lnr <= docText.lineAt(range.to).number; lnr++) {
                const line = docText.line(lnr);
                const lineType = this.lineType(line.from, tree);
                switch (lineType) {
                    case 'blockStart':
                        if (currentBlock.firstLine !== lnr) {
                            currentBlock = {
                                firstLine: lnr, special: true, defMarker: false, listLines: []
                            };
                            this.lineBlocks.push(currentBlock);
                        }
                        else
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
                            if (currentBlock.firstLine !== lnr) {
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
                        if (inContiguousBlock || (!currentBlock.special && !line.length)) {
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
        const newDecorations = [];
        for (let i = 0; i < this.lineBlocks.length; i++) {
            if (this.lineBlocks[i].special || !this.lineBlocks[i].defMarker)
                continue;
            let startline = this.lineBlocks[i].firstLine;
            let endline = i == this.lineBlocks.length - 1 ? lnr : this.lineBlocks[i + 1].firstLine;
            for (let n = startline; n < endline; n++) {
                const line = docText.line(n);
                if (line.text.startsWith(MARKER))
                    newDecorations.push(this.DEF_DEC.range(line.from), this.MARKER_DEC.range(line.from, line.from + MARKER_LEN));
                else if (this.lineBlocks[i].listLines.includes(n))
                    newDecorations.push(this.DD_LIST_DEC.range(line.from));
                else if (line.length)
                    newDecorations.push(this.TERM_DEC.range(line.from));
            }
        }
        this.decorations = state.RangeSet.of(newDecorations);
        this.never_updated = false;
    }
    adjustDecorationsAfterEdit(update) {
        this.decorations = this.decorations.map(update.changes);
        if (update.state.doc.lines !== this.numberOfLines)
            return this.decorateVisibleRangesFromScratch(update);
        let fullRedecorationRequired = false;
        update.changes.iterChangedRanges((f0, t0, f1, t1) => {
            if (fullRedecorationRequired)
                return;
            const line = update.state.doc.lineAt(f1);
            if (line.from + MARKER_LEN <= Math.min(f0, f1))
                return;
            if ((f0 === t0) !== (f1 === t1)) {
                fullRedecorationRequired = true;
                return;
            }
            for (var i = this.lineBlocks.length - 1; i >= 0; i--)
                if (this.lineBlocks[i].firstLine <= line.number)
                    break;
            const currentBlock = this.lineBlocks[i];
            if (!currentBlock.special && currentBlock.defMarker !== line.text.startsWith(MARKER)) {
                fullRedecorationRequired = true;
                return;
            }
        });
        if (fullRedecorationRequired)
            this.decorateVisibleRangesFromScratch(update);
    }
    lineType(pos, tree) {
        var _a, _b;
        let node = tree.resolveStack(pos, 1);
        while (node) {
            if (((_b = (_a = node.node) === null || _a === void 0 ? void 0 : _a.type) === null || _b === void 0 ? void 0 : _b.id) === 1)
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
    }
}
const liveUpdateDefinitionLists = view.ViewPlugin.fromClass(DocumentDecorationEngine, { decorations: dde => dde.decorations });
const postProcessDefinitionLists = function (element, context) {
    if (!element.classList.contains('el-p') &&
        !element.classList.contains('el-ul') &&
        !element.classList.contains('el-ol') &&
        !element.classList.contains('markdown-rendered'))
        return;
    let preChecked = false;
    if (element.classList.contains('el-p')) {
        if (!element.firstElementChild.innerHTML.match(definitionMarker))
            return;
        preChecked = true;
    }
    if (element.classList.contains('el-ul') || element.classList.contains('el-ol')) {
        if (!element.firstElementChild.lastElementChild.innerHTML.contains('\n'))
            return;
        const originalHTML = element.firstElementChild.lastElementChild
            .innerHTML;
        const newlinePos = originalHTML.indexOf('\n');
        element.firstElementChild.lastElementChild.innerHTML =
            originalHTML.slice(0, newlinePos);
        element.appendChild(document.createElement('p')).innerHTML =
            originalHTML.slice(newlinePos + 1);
        preChecked = true;
    }
    return new Promise((resultCallback) => {
        let paragraphs;
        if (preChecked)
            paragraphs = [element.lastElementChild];
        else
            paragraphs = element.findAll(':scope > div > p');
        paragraphs.forEach((par) => {
            if (!preChecked && !par.innerHTML.match(definitionMarker))
                return;
            const defList = document.createElement('dl');
            let startOfLine = true;
            let itemElement;
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
                        itemElement = defList.createEl('dt');
                    }
                    else {
                        itemElement = defList.createEl('p');
                    }
                    startOfLine = false;
                }
                itemElement.append(clone);
            });
            par.replaceWith(defList);
        });
        resultCallback(null);
    });
};
class DefinitionListSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.name = plugin.manifest.name;
        this.settings = plugin.settings;
        this.cssElement = plugin.cssElement;
        this.saveChanges = plugin.saveData.bind(plugin);
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('style', { text: `
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
		` });
        containerEl.createEl('h2', { text: this.name });
        let colorSett;
        new obsidian.Setting(containerEl)
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
        });
        let weightSett;
        new obsidian.Setting(containerEl)
            .setDesc('Bold font')
            .addToggle(tog => {
            tog.setValue(this.settings.dtbold)
                .onChange(newWeight => {
                console.debug('bold set to', newWeight);
                this.settings.dtbold = newWeight;
                this.cssElement.sheet.insertRule(`:root {
						--dtweight: ${newWeight ? 'bold' : 'inherit'}`, this.cssElement.sheet.cssRules.length);
                this.saveChanges(this.settings);
            });
            weightSett = tog;
        });
        let styleSett;
        new obsidian.Setting(containerEl)
            .setDesc('Italic font')
            .addToggle(tog => {
            tog.setValue(this.settings.dtitalic)
                .onChange(newStyle => {
                console.debug('italic set to', newStyle);
                this.settings.dtitalic = newStyle;
                this.cssElement.sheet.insertRule(`:root {
						--dtstyle: ${newStyle ? 'italic' : 'inherit'}`, this.cssElement.sheet.cssRules.length);
                this.saveChanges(this.settings);
            });
            styleSett = tog;
        });
        let indentSett;
        new obsidian.Setting(containerEl)
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
        });
        new obsidian.Setting(containerEl)
            .addButton(bt => bt.setButtonText('Reset to defaults')
            .setTooltip('Color: dark blue, #555577\nIndentation: 30 pixels')
            .onClick(evt => {
            colorSett.setValue(defaultSettings.dtcolor);
            weightSett.setValue(defaultSettings.dtbold);
            styleSett.setValue(defaultSettings.dtitalic);
            indentSett.setValue(defaultSettings.ddindentation);
        }));
        containerEl.createEl('div', { cls: 'setting-item-name', text: 'Preview' });
        containerEl.createEl('div', { cls: 'example markdown-preview-view' })
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

module.exports = DefinitionListPlugin;
