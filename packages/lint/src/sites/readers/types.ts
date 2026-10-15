// What a template language has to answer for the collector. Everything
// past these questions is shared: the value walker, component identity,
// contracts, messages. A reader hands over ESTree expressions, or its own
// literal and container nodes the walker unwraps by type.

export type ElementName = {
  // The `Dialog` of `<Dialog.Content>`. Empty when it cannot be read.
  root: string
  property: string | null
  // The tag as written.
  text: string
  // False for an intrinsic element.
  component: boolean
  // Vue's `<card-title>` for an imported `CardTitle`.
  alias?: string
}

export type Visitors = Record<string, (node: any) => void>

// A class channel outside the class attribute: the names the node
// carries by itself, and the node `elementOf` can place.
export type ExtraSite = {
  names: { value: string; node: any }[]
  anchor: any
}

export type TemplateReader = {
  attributes: string[]
  // Attributes the parser keeps in no node of their own, by the type of the
  // node that holds them (Angular's ICU); each is read as an attribute.
  heldAttributes?: Record<string, (node: any) => any[]>
  // Attributes that hold classes under a name of their own, past the
  // class-like names every reader shares.
  classAttributes?: string[]
  // Attributes whose class-like name holds something else.
  notClassAttributes?: string[]
  spreads: string[]
  attributeName: (node: any) => string
  // Null when the attribute has no value.
  attributeValue: (node: any) => any
  // The script strings an attribute is read from when they are not its
  // value. A scan of every string leaves them to the attribute.
  sourceStrings?: (node: any) => any[]
  spreadArgument: (node: any) => any
  // The element an attribute or a spread sits on.
  elementOf: (node: any) => any
  nameOf: (element: any) => ElementName | null
  // The nearest enclosing element, past fragments and blocks.
  parentElementOf: (element: any) => any
  // Base UI's render prop: the element the classes land on instead.
  renderedElementOf?: (element: any) => any
  // Class channels outside the class attribute, by node type.
  extraSites?: Record<string, (node: any) => ExtraSite | null>
  // Nodes that set one style property, by node type.
  styleProperties?: Record<
    string,
    (node: any) => { property: string; value: any } | null
  >
  // Markup whose `class` takes an object with classes as keys.
  // A function decides per attribute, by node and name.
  classObjects?: boolean | ((attribute: any, name: string) => boolean)
  // Markup where `style="color: red"` is how a style is written. In JSX
  // a string is not a style, and it stays unread.
  // A function decides per value, where a script holds a template too.
  staticStyles?: boolean | ((value: any) => boolean)
  // Node types the traversal can reach more than once.
  revisited?: string[]
  // A template identifier's variable when the parser's scopes stop at
  // the script.
  variableOf?: (node: any, context: any) => any
  // Markup with no imports to resolve a tag through: the names a contract's
  // pattern can match an element by, its tag and attributes; null for none.
  contractNames?: (element: any) => string[] | null
}
