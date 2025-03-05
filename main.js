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
const MARKER = ':   ';
const MARKER_REGEX = /(?:^|\n): {3}/;
const MARKER_LEN = MARKER.length;
const MAX_TERM_LEN = 100;
class DefinitionListPlugin extends obsidian.Plugin {
    constructor() {
        super(...arguments);
        this.cssElement = document.createElement('style');
    }
    onload() {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            console.log(`Loading plugin ${this.manifest.name} v${this.manifest.version}`);
            this.settings = Object.assign({}, defaultSettings, yield this.loadData());
            const sizerContainer = this.app.workspace.containerEl.createEl('div', { cls: 'markdown-preview-view' });
            const sizer = sizerContainer.createEl('span', {
                text: MARKER,
                attr: { style: "visibility: hidden; white-space: pre;" }
            });
            const markerWidth = Math.round(((_a = sizer.getBoundingClientRect()) === null || _a === void 0 ? void 0 : _a.width) || 18);
            sizerContainer.remove();
            this.cssElement.textContent = `:root {
			--dtcolor: ${this.settings.dtcolor};
			--dtweight: ${this.settings.dtbold ? 'bold' : 'inherit'};
			--dtstyle: ${this.settings.dtitalic ? 'italic' : 'inherit'};
			--ddindentation: ${this.settings.ddindentation}px;
			--ddmarkerindent: -${markerWidth}px;
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
        this.BLOCK_START_TYPES = [
            'HyperMD-codeblock_HyperMD-codeblock-begin_HyperMD-codeblock-begin-bg_HyperMD-codeblock-bg',
            'formatting_formatting-math_formatting-math-begin_keyword_math_math-block'
        ];
        this.BLOCK_INNER_TYPES = [
            'hmd-codeblock_variable', 'hmd-codeblock_keyword', 'math_variable-'
        ];
        this.BLOCK_END_TYPES = [
            'HyperMD-codeblock_HyperMD-codeblock-bg_HyperMD-codeblock-end_HyperMD-codeblock-end-bg',
            'formatting_formatting-math_formatting-math-end_keyword_math_math-'
        ];
        this.CONTIGUOUS_BLOCK_TYPES = [
            'HyperMD-header_HyperMD-header-', 'HyperMD-quote_HyperMD-quote-',
            'HyperMD-table-_HyperMD-table-row_HyperMD-table-row-',
            'formatting_formatting-image_image_image-marker',
            'HyperMD-list-line_HyperMD-list-line-_HyperMD-task-line', 'hr'
        ];
        this.LIST_TYPES = ['HyperMD-list-line_HyperMD-list-line-'];
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
            return this.decorateVisibleRangesFromScratch(update);
        }
        if (update.docChanged) {
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
                currentBlock = { firstLine: lnr, special: false, defMarkers: [], listLines: [] };
                this.lineBlocks.push(currentBlock);
            }
            for (; lnr <= docText.lineAt(range.to).number; lnr++) {
                const line = docText.line(lnr);
                const lineType = this.lineType(line.from, tree);
                switch (lineType) {
                    case 'blockStart':
                        if (currentBlock.firstLine !== lnr) {
                            currentBlock = {
                                firstLine: lnr, special: true, defMarkers: [], listLines: []
                            };
                            this.lineBlocks.push(currentBlock);
                        }
                        else
                            currentBlock.special = true;
                        break;
                    case 'blockEnd':
                        currentBlock.special = true;
                        currentBlock = {
                            firstLine: lnr + 1, special: false, defMarkers: [], listLines: []
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
                                    firstLine: lnr, special: true, defMarkers: [], listLines: []
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
                                    firstLine: lnr, special: false, defMarkers: [], listLines: []
                                };
                                this.lineBlocks.push(currentBlock);
                            }
                            inContiguousBlock = false;
                        }
                        if (line.text.startsWith(MARKER))
                            currentBlock.defMarkers.push(lnr);
                        else if (lineType === 'listItem')
                            currentBlock.listLines.push(lnr);
                }
            }
        }
        const newDecorations = [];
        for (let i = 0; i < this.lineBlocks.length; i++) {
            if (this.lineBlocks[i].special || !this.lineBlocks[i].defMarkers.length)
                continue;
            let startline = this.lineBlocks[i].firstLine;
            let endline = (i == this.lineBlocks.length - 1) ? lnr :
                this.lineBlocks[i + 1].firstLine;
            for (let n = startline; n < endline; n++) {
                const line = docText.line(n);
                if (line.text.startsWith(MARKER))
                    newDecorations.push(this.DEF_DEC.range(line.from), this.MARKER_DEC.range(line.from, line.from + MARKER_LEN));
                else if (this.lineBlocks[i].listLines.includes(n))
                    newDecorations.push(this.DD_LIST_DEC.range(line.from));
                else if (line.length > 0 && line.length <= MAX_TERM_LEN)
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
        update.changes.iterChangedRanges((f0, _t0, f1, t1) => {
            if (fullRedecorationRequired)
                return;
            const line = update.state.doc.lineAt(f1);
            if (line.from + MARKER_LEN <= Math.min(f0, f1))
                return;
            if (line.length === t1 - f1) {
                fullRedecorationRequired = true;
                return;
            }
            let i = this.lineBlocks.length - 1;
            for (; i >= 0; i--)
                if (this.lineBlocks[i].firstLine <= line.number)
                    break;
            const currentBlock = this.lineBlocks[i];
            if (currentBlock.special === !line.text.match(/^(\$\$|```|> )/)) {
                fullRedecorationRequired = true;
                return;
            }
            if (!currentBlock.special &&
                currentBlock.defMarkers.includes(line.number) !== line.text.startsWith(MARKER)) {
                if (line.text.startsWith(MARKER)) {
                    currentBlock.defMarkers.push(line.number);
                    if (currentBlock.defMarkers.length === 1) {
                        fullRedecorationRequired = true;
                        return;
                    }
                    this.decorations = this.decorations.update({
                        add: [
                            this.DEF_DEC.range(line.from),
                            this.MARKER_DEC.range(line.from, line.from + MARKER_LEN)
                        ],
                        filter: (_f, _t, d) => (this.TERM_CLASS !== d.spec.class),
                        filterFrom: line.from,
                        filterTo: line.to
                    });
                }
                else {
                    currentBlock.defMarkers.remove(line.number);
                    if (!currentBlock.defMarkers.length) {
                        fullRedecorationRequired = true;
                        return;
                    }
                    this.decorations = this.decorations.update({
                        filter: (_f, _t, d) => ![this.MARKER_CLASS, this.DEF_CLASS].includes(d.spec.class),
                        filterFrom: line.from,
                        filterTo: line.to,
                        add: [this.TERM_DEC.range(line.from)]
                    });
                }
            }
            if (!currentBlock.special &&
                currentBlock.listLines.includes(line.number) === !line.text.match(/^(\*|-|\+|\d+\.) /)) {
                if (!currentBlock.listLines.includes(line.number)) {
                    currentBlock.listLines.push(line.number);
                    this.decorations = this.decorations.update({
                        add: [this.DD_LIST_DEC.range(line.from)],
                        filter: (_f, _t, d) => (this.TERM_CLASS !== d.spec.class),
                        filterFrom: line.from,
                        filterTo: line.to
                    });
                }
                else {
                    currentBlock.listLines.remove(line.number);
                    this.decorations = this.decorations.update({
                        filter: (_f, _t, d) => (this.DD_LIST_CLASS !== d.spec.class),
                        filterFrom: line.from,
                        filterTo: line.to,
                        add: [this.TERM_DEC.range(line.from)]
                    });
                }
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
            const name = node.node.name.replace(/\d/g, '');
            if (this.BLOCK_START_TYPES.contains(name))
                return 'blockStart';
            if (this.BLOCK_INNER_TYPES.contains(name))
                return 'block';
            if (this.BLOCK_END_TYPES.contains(name))
                return 'blockEnd';
            if (this.CONTIGUOUS_BLOCK_TYPES.contains(name))
                return 'contiguousBlock';
            if (this.LIST_TYPES.contains(name))
                return 'listItem';
            node = node.next;
        }
    }
}
const liveUpdateDefinitionLists = view.ViewPlugin.fromClass(DocumentDecorationEngine, { decorations: dde => dde.decorations });
const postProcessDefinitionLists = function (element) {
    if (!element.classList.contains('el-p') &&
        !element.classList.contains('el-ul') &&
        !element.classList.contains('el-ol') &&
        !element.classList.contains('markdown-rendered'))
        return;
    let preCheckedPar = false, preCheckedList = false;
    if (element.classList.contains('el-p')) {
        if (!element.firstElementChild.innerHTML.match(MARKER_REGEX))
            return;
        preCheckedPar = true;
    }
    else if (element.classList.contains('el-ul') || element.classList.contains('el-ol')) {
        if (!element.findAll('li').find(li => li.innerHTML.match(MARKER_REGEX)))
            return;
        preCheckedList = true;
    }
    return new Promise((resultCallback) => {
        let paragraphs = [], listItems = [];
        if (preCheckedPar)
            paragraphs = [element.lastElementChild];
        else if (preCheckedList)
            listItems = element.findAll('ul > li, ol > li')
                .filter(li => li.innerHTML.match(MARKER_REGEX));
        else {
            paragraphs = element.findAll(':scope > div > p');
            listItems = element.findAll('scope: > div > * > li')
                .filter(li => li.innerHTML.match(MARKER_REGEX));
        }
        let startOfLine;
        let itemElement;
        function insertClonedNode(node, defList) {
            if ('tagName' in node && node.tagName === "BR") {
                startOfLine = true;
                return;
            }
            const clone = node.cloneNode(true);
            if (startOfLine) {
                if (node.textContent.match(MARKER_REGEX)) {
                    itemElement = defList.createEl('dd');
                    clone.textContent = node.textContent.slice(4);
                }
                else if (node.textContent.length <= MAX_TERM_LEN) {
                    itemElement = defList.createEl('dt');
                }
                else {
                    itemElement = defList.createEl('p');
                }
                startOfLine = false;
            }
            itemElement.append(clone);
        }
        paragraphs.forEach((par) => {
            if (!preCheckedPar && !par.innerHTML.match(MARKER_REGEX))
                return;
            const defList = document.createElement('dl');
            startOfLine = true;
            par.childNodes.forEach(node => insertClonedNode(node, defList));
            par.replaceWith(defList);
        });
        listItems.forEach(li => {
            const originalHTML = li.innerHTML;
            const newlinePos = originalHTML.match(MARKER_REGEX).index;
            li.innerHTML = originalHTML.slice(0, newlinePos);
            const defList = document.createElement('dl');
            li.parentElement.insertAdjacentElement('afterend', defList);
            const virtual = document.createElement('div');
            virtual.innerHTML = originalHTML.slice(newlinePos + 1);
            startOfLine = true;
            virtual.childNodes.forEach(node => insertClonedNode(node, defList));
            if (!li.nextElementSibling)
                return;
            const newList = li.parentElement.cloneNode(false);
            defList.insertAdjacentElement('afterend', newList);
            let nextLi = li.nextElementSibling;
            while (nextLi) {
                const afterThatLi = nextLi.nextElementSibling;
                newList.append(nextLi);
                nextLi = afterThatLi;
            }
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
            .onClick(() => {
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
