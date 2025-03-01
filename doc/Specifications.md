# Specifications of the plugin
The concept of a **Definition list** is easy enough to understand: it's a list of terms and their meanings. There's a term, then there's some text that defines the term; another term, text that defines it; and so on. But many situations are not so straightforward:

* Terms without defining text, e.g. to expand abbreviations. For example, your glossary of slang might include a line _LOL = laughing out loud_, which doesn't require further explanation, so it isn't followed by definition text. Maybe the next line is another term, with its definition underneath, so we have a sequence _term_, _term_, _definition text_.
* Multiple definition-text blocks. A definition may be long, and it may be a good idea to divide it into paragraphs. So we have _term_, _definition text_, _more definition text_. 
* A _list_ (like the one you're reading), but as part of defining text. For example, the definition of the term _local government_ might start with a sentence of explanatory text and then have a bullet list of the various types of local government – state, province, county, city. We have a sequence _term_, _definition text including list_. This list should 'hang inside' the definition text, indented beyond the indentation of that text block (whereas normally, Markdown lists are indented very little).

  To avoid interfering with Obsidian's built-in list parser, I prefer to leave list _syntax_ untouched: starting the list item with a `*` seems better than starting it with <code>:&nbsp;&nbsp;&nbsp;*</code> and forcing the plugin to handle all of the parsing and formatting. The plugin should just take care of the right indentation.   
* A definition continued below other stuff. The definition of _standard deviation_ might have some initial text, then a formula in its own block (entered between `$$` and `$$`), then some concluding text. The formula block isn't absorbed into the definition-text block, but the line after the formula should be styled as definition text again. Therefore, the block after the formula _starts_ with definition text: _definition text_, _term_, _defintion text_ and so on.

The examples show the need for a precise specification of the plugin's behaviors.

### Rule 1: definition marker
The marker that distinguishes a definition list from any other sort of content is the four-character sequence <code>:&nbsp;&nbsp;&nbsp;</code> (a colon and three spaces) at the start of a line. Therefore, the first rule is:

* A definition list is always characterized by the presence of at least one **definition marker** at the start of a line. Without such a marker in the block, it's regular Markdown.

### Rule 2: block limitation
One marker should not make an entire document into a definition list. Its influence must be limited to its direct vicinity, a _block_ that runs from one empty line to the next, or from a header until an empty line, or from a code block to another code block. The second rule is:

* Around the definition marker, **all lines** become part of the definition list (either as terms or as definition text) in both directions **up to not including** any empty line, header, code block, block formula, block quote – anything that isn't a plain line of text, a line starting with a definition marker, or a Markdown list.

### Rule 3: two roles in a definition list
Within the definition list that's delimited by rule 2, every line is either a _term_ or _definition text_. In particular, a Markdown list becomes part of definition text. A line that's too long to be credible as a term or abbreviation-with-expansion, should probably be considered definiton text (or a regular line of text? Or even a block delimiter as meant in Rule 2? TBD!). The third rule is:

* Inside a definition list, every line is either a **term** or **definition text**. A term is regular text of no more than 100 characters, not started by a definition marker. Definition text is
   - a line starting with a definition marker
   - a line longer than 100 characters
   - a line that's part of a Markdown list.

### Rule 4: formatting
The two types of text should be easy to distinguish. The term starts at the left margin, whereas the definition text is indented. It usually looks good to have the term in bold and/or italic, and perhaps in a different color from regular text. The fourth rule is:

* Inside a definition list, all text is formatted different from regular text:
   - a term starts at the left margin and has a distinct font format – by default, royal blue boldface
   - definition text is indented from the left margin
   - a list inside definition text has the same indentation with respect to the left side of definition text that a regular Markdown list has with respect to the left page margin.

## Parsing algorithm
While going through the document text,
1. Find and record the locations of block boundaries.
2. Find and record the locations of definition markers and check that they're not inside a special block (e.g. a code or formula block).
3. The results of 1. and 2. tell you the _definition list_ blocks. Go through each of them and set the formatting of every line:
   - a line that starts with regular characters (not `*`, `-`, `1.`, or the definition marker) is a _term_
   - a line that starts with the definition marker is _definition text_
   - a line that's also a list item is _list in definition text_, with the styling that comes with that.


## Examples

If you have just abbreviation-expansions and no actual defining text, you can still format it as a definition list by starting or ending with a line that only has a definition marker:

```
LOL = laughing out loud
OMG = oh my God
ROFL = rolling on the floor laughing
:    
```

