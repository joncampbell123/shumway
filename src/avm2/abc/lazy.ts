module Shumway.AVMX {
  import assert = Shumway.Debug.assert;
  import hashBytesTo32BitsAdler = Shumway.HashUtilities.hashBytesTo32BitsAdler;
  import AbcStream = Shumway.AVM2.ABC.AbcStream;

  var writer = new IndentingWriter();

  /**
   * Naming Conventions:
   *
   *  mn:   multiname;
   *  nm:   name
   *  ns:   namespace
   *  nss:  namespace set
   *
   * Parsing is a combination of lazy and eager evaluation. String parsing is deferred until
   * it is needed for multiname parsing.
   */

  export enum CONSTANT {
    Undefined          = 0x00,
    Utf8               = 0x01,
    Float              = 0x02,
    Int                = 0x03,
    UInt               = 0x04,
    PrivateNs          = 0x05,
    Double             = 0x06,
    QName              = 0x07,
    Namespace          = 0x08,
    Multiname          = 0x09,
    False              = 0x0A,
    True               = 0x0B,
    Null               = 0x0C,
    QNameA             = 0x0D,
    MultinameA         = 0x0E,
    RTQName            = 0x0F,
    RTQNameA           = 0x10,
    RTQNameL           = 0x11,
    RTQNameLA          = 0x12,
    NameL              = 0x13,
    NameLA             = 0x14,
    NamespaceSet       = 0x15,
    PackageNamespace   = 0x16,
    PackageInternalNs  = 0x17,
    ProtectedNamespace = 0x18,
    ExplicitNamespace  = 0x19,
    StaticProtectedNs  = 0x1A,
    MultinameL         = 0x1B,
    MultinameLA        = 0x1C,
    TypeName           = 0x1D,

    ClassSealed        = 0x01,
    ClassFinal         = 0x02,
    ClassInterface     = 0x04,
    ClassProtectedNs   = 0x08
  }

  export enum METHOD {
    Arguments           = 0x1,
    Activation          = 0x2,
    Needrest            = 0x4,
    HasOptional         = 0x8,
    IgnoreRest          = 0x10,
    Native              = 0x20,
    Setsdxns            = 0x40,
    HasParamNames       = 0x80,
    // Flags that're derived at runtime, not present in the bytecode.
    HasBody             = 0x100,
    InstanceInitializer = 0x200,
    ClassInitializer    = 0x400,
    ScriptInitializer   = 0x800
  }

  export enum TRAIT {
    Slot               = 0,
    Method             = 1,
    Getter             = 2,
    Setter             = 3,
    Class              = 4,
    Function           = 5,
    Const              = 6
  }

  export enum ATTR {
    Final              = 0x01,
    Override           = 0x02,
    Metadata           = 0x04
  }

  export enum SORT {
    CASEINSENSITIVE = 1,
    DESCENDING = 2,
    UNIQUESORT = 4,
    RETURNINDEXEDARRAY = 8,
    NUMERIC = 16,
  }

  export class MetadataInfo {
    constructor(
      public abc: ABCFile,
      public name: String | number,
      public keys: Uint32Array,
      public values: Uint32Array
    ) {
      // ...
    }

    getName(): string {
      if (typeof this.name === "number") {
        this.name = this.abc.getString(<number>this.name);
      }
      return <string>this.name;
    }

    getValueAt(i: number): string {
      return this.abc.getString(this.values[i]);
    }

    getValue(key: string): string {
      for (var i = 0; i < this.keys.length; i++) {
        if (this.abc.getString(this.keys[i]) === key) {
          return this.abc.getString(this.values[i]);
        }
      }
      return null;
    }
  }

  export class Traits {
    private _nextSlotID: number = 1;
    public slots: SlotTraitInfo [] = null;
    constructor(
      public traits: TraitInfo []
    ) {
      // ...
    }

    resolve() {
      for (var i = 0; i < this.traits.length; i++) {
        this.traits[i].resolve();
      }
    }

    attachHolder(holder: Info) {
      for (var i = 0; i < this.traits.length; i++) {
        release || assert(!this.traits[i].holder);
        this.traits[i].holder = holder;
      }
    }

    trace(writer: IndentingWriter) {
      this.resolve();
      this.traits.forEach(x => writer.writeLn(x.toString()));
    }

    /**
     * Searches for a trait with the specified name and kind. Use |-1| for the kind
     * if you don't care about the kind.
     */
    indexOf(mn: Multiname, kind: TRAIT): number {
      var mnName = mn.name;
      var nss = mn.namespaces;
      var traits = this.traits;
      for (var i = 0; i < traits.length; i++) {
        var trait = traits[i];
        if (kind >= 0 && trait.kind !== kind) {
          continue;
        }
        var traitMn = <Multiname>trait.name;
        if (traitMn.name === mnName) {
          var nsName = traitMn.namespaces[0].name;
          for (var j = 0; j < nss.length; j++) {
            if (nsName === nss[j].name) {
              return i;
            }
          }
        }
      }
      return -1;
    }

    getTrait(mn: Multiname, kind: TRAIT): TraitInfo {
      var i = this.indexOf(mn, kind);
      if (i >= 0) {
        return this.traits[i];
      }
      return null;
    }

    concat(traits: Traits): Traits {
      // Resolve traits so that indexOf works out.
      this.resolve();
      traits.resolve();

      var a = this.traits.slice(0);
      var b = traits.traits;
      for (var i = 0; i < b.length; i++) {
        var t = b[i];
        if (t.isMethodOrAccessor()) {
          if (t.getName().name === "aBar") {
            debugger;
          }
          var j = this.indexOf(t.getName(), t.kind);
          if (j >= 0) {
            a[j] = t;
            continue;
          }
        }
        a.push(t);
      }
      return new Traits(a);
    }

    getSlot(i: number): TraitInfo {
      if (this.slots === null) {
        var slots = this.slots = [];
        for (var j = 0; j < this.traits.length; j++) {
          var trait = this.traits[j];
          if (trait.kind === TRAIT.Slot ||
              trait.kind === TRAIT.Const ||
              trait.kind === TRAIT.Class) {
            var slotTrait: SlotTraitInfo = <SlotTraitInfo>trait;
            if (!slotTrait.slot) {
              slotTrait.slot = this._nextSlotID ++;
            } else {
              this._nextSlotID = slotTrait.slot + 1;
            }
            assert (!slots[slotTrait.slot]);
            slots[slotTrait.slot] = slotTrait;
          }
        }
      }
      return this.slots[i];
    }
  }

  export class TraitInfo {
    public holder: Info;
    public metadata: MetadataInfo [] | Uint32Array;

    constructor(
      public abc: ABCFile,
      public kind: TRAIT,
      public name: Multiname | number
    ) {
      this.metadata = null;
      this.holder = null;
    }

    getMetadata(): MetadataInfo [] {
      if (!this.metadata) {
        return null;
      }
      if (this.metadata instanceof Uint32Array) {
        var metadata = new Array(this.metadata.length);
        for (var i = 0; i < this.metadata.length; i++) {
          metadata[i] = this.abc.getMetadataInfo(<number>this.metadata[i]);
        }
        this.metadata = metadata;
      }
      return <MetadataInfo []>this.metadata;
    }

    getName(): Multiname {
      return <Multiname>this.name;
    }

    resolve() {
      if (typeof this.name === "number") {
        this.name = this.abc.getMultiname(<number>this.name);
      }
    }

    toString() {
      return TRAIT[this.kind] + " " + this.name;
    }

    isMethod(): boolean {
      return this.kind === TRAIT.Method;
    }

    isGetter(): boolean {
      return this.kind === TRAIT.Getter;
    }

    isSetter(): boolean {
      return this.kind === TRAIT.Setter;
    }

    isAccessor(): boolean {
      return this.kind === TRAIT.Getter ||
             this.kind === TRAIT.Setter;
    }

    isMethodOrAccessor(): boolean {
      return this.isAccessor() || this.kind === TRAIT.Method;
    }
  }

  export class SlotTraitInfo extends TraitInfo {
    constructor(
      abc: ABCFile,
      kind: TRAIT,
      name: Multiname | number,
      public slot: number,
      public type: Multiname | number,
      public defaultValueKind: CONSTANT,
      public defaultValueIndex: number
    ) {
      super(abc, kind, name);
    }

    hasDefaultValue(): boolean {
      return this.defaultValueKind >= 0;
    }

    getDefaultValue(): any {
      return this.abc.getConstant(this.defaultValueKind, this.defaultValueIndex);
    }
  }

  export class MethodTraitInfo extends TraitInfo {
    public method: Function = null;
    constructor(
      abc: ABCFile,
      kind: TRAIT,
      name: Multiname | number,
      public methodInfo: MethodInfo | number
    ) {
      super(abc, kind, name);
    }

    getMethodInfo(): MethodInfo {
      return <MethodInfo>this.methodInfo;
    }

    resolve() {
      super.resolve();
      if (typeof this.methodInfo === "number") {
        this.methodInfo = this.abc.getMethodInfo(<number>this.methodInfo);
      }
    }
  }

  export class ClassTraitInfo extends SlotTraitInfo {
    constructor(
      abc: ABCFile,
      kind: TRAIT,
      name: Multiname | number,
      slot: number,
      public classInfo: ClassInfo
    ) {
      super(abc, kind, name, slot, 0, 0, -1);
    }
  }

  export class ParameterInfo {
    constructor(
      public abc: ABCFile,
      public type: Multiname | number,
      /**
       * Don't rely on the name being correct.
       */
      public name: string | number,
      public optionalValueKind: CONSTANT,
      public optionalValueIndex: number
    ) {
      // ...
    }

    getName(): string {
      if (typeof this.name === "number") {
        this.name = this.abc.getString(<number>this.name);
      }
      return <string>this.name;
    }

    getType(): Multiname {
      if (typeof this.type === "number") {
        this.type = this.abc.getMultiname(<number>this.type);
      }
      return <Multiname>this.type;
    }

    hasOptionalValue(): boolean {
      return this.optionalValueKind >= 0;
    }

    getOptionalValue(): any {
      return this.abc.getConstant(this.optionalValueKind, this.optionalValueIndex);
    }

    toString() {
      var str = "";
      if (this.name) {
        str += this.getName();
      } else {
        str += "?";
      }
      if (this.type) {
        str += ": " + this.getType().name;
      }
      if (this.optionalValueKind >= 0) {
        str += " = " + this.abc.getConstant(this.optionalValueKind, this.optionalValueIndex);
      }
      return str;
    }
  }

  export class Info {

  }

  export class InstanceInfo extends Info {
    public classInfo: ClassInfo = null;
    public runtimeTraits: Traits = null;
    constructor(
      public abc: ABCFile,
      public name: Multiname | number,
      public superName: Multiname | number,
      public flags: number,
      public protectedNs: number,
      public interfaces: number [],
      public initializer: MethodInfo | number,
      public traits: Traits
    ) {
      super();
    }

    getInitializer(): MethodInfo {
      if (typeof this.initializer === "number") {
        this.initializer = this.abc.getMethodInfo(<number>this.initializer);
      }
      return <MethodInfo>this.initializer;
    }

    getName(): Multiname {
      if (typeof this.name === "number") {
        this.name = this.abc.getMultiname(<number>this.name);
      }
      return <Multiname>this.name;
    }

    getSuperName(): Multiname {
      if (typeof this.superName === "number") {
        this.superName = this.abc.getMultiname(<number>this.superName);
      }
      return <Multiname>this.superName;
    }

    toString() {
      return "InstanceInfo " + this.getName().name;
    }

    trace(writer: IndentingWriter) {
      writer.enter("InstanceInfo: " + this.getName());
      this.superName && writer.writeLn("Super: " + this.getSuperName());
      this.traits.trace(writer);
      writer.outdent();
    }

    isInterface(): boolean {
      return !!(this.flags & CONSTANT.ClassInterface);
    }
  }

  export class ScriptInfo extends Info {
    public global: AXGlobal = null;
    public state: ScriptInfoState = ScriptInfoState.None;
    constructor(
      public abc: ABCFile,
      public initializer: number,
      public traits: Traits
    ) {
      super();
    }

    getInitializer(): MethodInfo {
      return this.abc.getMethodInfo(this.initializer);
    }

    trace(writer: IndentingWriter) {
      writer.enter("ScriptInfo");
      this.traits.trace(writer);
      writer.outdent();
    }
  }

  export class ClassInfo extends Info {
    public trait: ClassTraitInfo = null;
    constructor(
      public abc: ABCFile,
      public instanceInfo: InstanceInfo,
      public initializer: MethodInfo | number,
      public traits: Traits
    ) {
      super();
    }

    getNativeMetadata(): MetadataInfo {
      if (!this.trait) {
        return null;
      }
      var metadata = this.trait.getMetadata();
      if (!metadata) {
        return null;
      }
      for (var i = 0; i < metadata.length; i++) {
        if (metadata[i].getName() === "native") {
          return metadata[i];
        }
      }
      return null;
    }

    getInitializer(): MethodInfo {
      if (typeof this.initializer === "number") {
        return this.initializer = this.abc.getMethodInfo(<number>this.initializer)
      }
      return <MethodInfo>this.initializer;
    }

    toString() {
      return "ClassInfo " + this.instanceInfo.getName();
    }

    trace(writer: IndentingWriter) {
      writer.enter("ClassInfo");
      this.traits.trace(writer);
      writer.outdent();
    }
  }

  export class ExceptionInfo {
    constructor(
      public start: number,
      public end: number,
      public target: number,
      public type: number,
      public varName: number
    ) {
      // ...
    }
  }

  export class MethodBodyInfo extends Info {
    public activationPrototype: Object = null;
    constructor(
      public maxStack: number,
      public localCount: number,
      public initScopeDepth: number,
      public maxScopeDepth: number,
      public code: Uint8Array,
      public exceptions: ExceptionInfo [],
      public traits: Traits
    ) {
      super();
    }

    trace(writer: IndentingWriter) {
      writer.writeLn("Code: " + this.code.length);
    }
  }

  export class MethodInfo {
    public trait: MethodTraitInfo = null;
    private _body: MethodBodyInfo;
    constructor(
      public abc: ABCFile,
      private _index: number,
      public name: number,
      public returnType: number,
      public parameters: ParameterInfo [],
      public optionalCount: number,
      public flags: number
    ) {
      this._body = null;
    }

    getNativeMetadata(): MetadataInfo {
      if (!this.trait) {
        return null;
      }
      var metadata = this.trait.getMetadata();
      if (!metadata) {
        return null;
      }
      for (var i = 0; i < metadata.length; i++) {
        if (metadata[i].getName() === "native") {
          return metadata[i];
        }
      }
      return null;
    }

    getBody(): MethodBodyInfo {
      return this._body || (this._body = this.abc.getMethodBodyInfo(this._index));
    }

    toString() {
      var str = "anonymous";
      if (this.name) {
        str = this.abc.getString(this.name);
      }
      str += " (" + this.parameters.join(", ") + ")";
      if (this.returnType) {
        str += ": " + this.abc.getMultiname(this.returnType).name;
      }
      return str;
    }

    isNative(): boolean {
      return !!(this.flags & METHOD.Native);
    }
  }

  export class Multiname {
    private static _nextID = 1;
    public id: number = Multiname._nextID ++;
    constructor(
      public abc: ABCFile,
      public index: number,
      public kind: CONSTANT,
      public namespaces: Namespace [],
      public name: any,
      public parameterType: Multiname = null
    ) {
      // ...
    }

    public getMangledName(): any {
      assert (this.isQName());
      return "$" + this.namespaces[0].getMangledName() + this.name;
    }

    public getPublicMangledName(): any {
      return "$Bg" + this.name;
    }

    private _nameToString(): string {
      if (this.isAnyName()) {
        return "*";
      }
      return this.isRuntimeName() ? "[]" : this.name;
    }

    public toString() {
      var str = CONSTANT[this.kind] + " ";
      str += this.isAttribute() ? "@" : "";
      if (this.isRuntimeNamespace()) {
        str += "[]::" + this._nameToString();
      } else if (this.isQName()) {
        str += this.namespaces[0] + "::";
        str += this._nameToString();
      } else {
        str += "{" + this.namespaces.map(x => String(x)).join(", ") + "}";
        str += "::" + this._nameToString();
      }
      if (this.parameterType) {
        str += "<" + this.parameterType + ">";
      }
      return str;
    }

    public isRuntime(): boolean {
      switch (this.kind) {
        case CONSTANT.QName:
        case CONSTANT.QNameA:
        case CONSTANT.Multiname:
        case CONSTANT.MultinameA:
          return false;
      }
      return true;
    }

    public isRuntimeName(): boolean {
      switch (this.kind) {
        case CONSTANT.RTQNameL:
        case CONSTANT.RTQNameLA:
        case CONSTANT.MultinameL:
        case CONSTANT.MultinameLA:
          return true;
      }
      return false;
    }

    public isRuntimeNamespace(): boolean {
      switch (this.kind) {
        case CONSTANT.RTQName:
        case CONSTANT.RTQNameA:
        case CONSTANT.RTQNameL:
        case CONSTANT.RTQNameLA:
          return true;
      }
      return false;
    }

    public isAnyName(): boolean {
      return !this.isRuntimeName() && this.name === "";
    }

    public isAnyNamespace(): boolean {
      if (this.isRuntimeNamespace() || this.namespaces.length > 1) {
        return false;
      }
      return this.namespaces[0].name === "";

      // x.* has the same meaning as x.*::*, so look for the former case and give
      // it the same meaning of the latter.
      // return !this.isRuntimeNamespace() &&
      //  (this.namespaces.length === 0 || (this.isAnyName() && this.namespaces.length !== 1));
    }

    public isQName(): boolean {
      return this.namespaces.length === 1 && !this.isAnyName();
    }

    public isAttribute(): boolean {
      switch (this.kind) {
        case CONSTANT.QNameA:
        case CONSTANT.RTQNameA:
        case CONSTANT.RTQNameLA:
        case CONSTANT.MultinameA:
        case CONSTANT.MultinameLA:
          return true;
      }
      return false;
    }

    public static getPublicMangledName(value: any): any {
      return "$Bg" + value;
    }

    public static getMangledName(value: any): any {
      if (value instanceof Multiname) {
        return value.getMangledName();
      }
      return Multiname.getPublicMangledName(value);
    }

    public static isPublicQualifiedName(value: any): boolean {
      // FIX ME
      return false;
    }
  }

  export class Namespace {
    public prefix: string = "";
    private _mangledName: string = null;
    constructor(public abc: ABCFile, public kind: CONSTANT, public name: string) {
      assert (kind !== undefined);
    }

    toString() {
      return CONSTANT[this.kind] + (this.name !== "" ? ":" + this.name : "");
    }

    private static _knownNames = [
      ""
    ];

    private static _hashNamespace(kind: CONSTANT, name: string, prefix: string) {
      var index = Namespace._knownNames.indexOf(name);
      if (index >= 0) {
        return kind << 2 | index;
      }
      var data = new Int32Array(1 + name.length + prefix.length);
      var j = 0;
      data[j++] = kind;
      for (var i = 0; i < name.length; i++) {
        data[j++] = name.charCodeAt(i);
      }
      for (var i = 0; i < prefix.length; i++) {
        data[j++] = prefix.charCodeAt(i);
      }
      return Shumway.HashUtilities.hashBytesTo32BitsMD5(data, 0, j);
    }

    public getMangledName(): string {
      if (this._mangledName !== null) {
        return this._mangledName;
      }
      return this._mangledName = Shumway.StringUtilities.variableLengthEncodeInt32(Namespace._hashNamespace(this.kind, this.name, this.prefix))
    }

    public static PUBLIC = new Namespace(null, CONSTANT.Namespace, "");
    public static PROTECTED = new Namespace(null, CONSTANT.ProtectedNamespace, "");
    public static PROXY = new Namespace(null, CONSTANT.Namespace, "http://www.adobe.com/2006/actionscript/flash/proxy");
    public static VECTOR = new Namespace(null, CONSTANT.Namespace, "__AS3__.vec");
    public static VECTOR_PACKAGE = new Namespace(null, CONSTANT.PackageInternalNs, "__AS3__.vec");
    public static BUILTIN = new Namespace(null, CONSTANT.PrivateNs, "builtin.as$0");
  }

  export class ABCFile {
    public hash: number;
    public ints: Int32Array;
    public uints: Uint32Array;
    public doubles: Float64Array;

    /**
     * Application domain in which this ABC is loaded.
     */
    private _applicationDomain: ApplicationDomain = null;

    public get applicationDomain() {
      return this._applicationDomain;
    }

    public setApplicationDomain(applicationDomain: ApplicationDomain) {
      assert(this._applicationDomain === null && applicationDomain);
      this._applicationDomain = applicationDomain;
    }

    private _stream: AbcStream;

    private _strings: string [];
    private _stringOffsets: Uint32Array;

    private _namespaces: Namespace [];
    private _namespaceOffsets: Uint32Array;

    private _namespaceSets: Namespace [][];
    private _namespaceSetOffsets: Uint32Array;

    private _multinames: Multiname [];
    private _multinameOffsets: Uint32Array;

    private _metadata: MetadataInfo [];
    private _metadataInfoOffsets: Uint32Array;

    private _methods: MethodInfo [];
    private _methodBodies: MethodBodyInfo [];
    private _methodInfoOffsets: Uint32Array;

    public classes: ClassInfo [];
    public scripts: ScriptInfo [];
    public instances: InstanceInfo [];

    constructor(
      private _buffer: Uint8Array,
      private _fileName?: string
    ) {
      this._applicationDomain = null;
      this._stream = new AbcStream(_buffer);
      this.hash = hashBytesTo32BitsAdler(_buffer, 0, _buffer.length);
      this._checkMagic();

      this._parseConstantPool();
      this._parseNamespaces();
      this._parseNamespaceSets();
      this._parseMultinames();

      this._parseMethodInfos();
      this._parseMetaData();
      this._parseInstanceAndClassInfos();
      this._parseScriptInfos();
      this._parseMethodBodyInfos();

      this.trace(writer);
      // this.stress();
    }

    private _parseConstantPool() {
      this._parseNumericConstants();
      this._parseStringConstants();
    }

    private _parseNumericConstants() {
      var n = 0, s = this._stream;

      // Parse Signed Integers
      n = s.readU30();
      var ints = new Int32Array(n);
      ints[0] = 0;
      for (var i = 1; i < n; i++) {
        ints[i] = s.readS32();
      }
      this.ints = ints;

      // Parse Unsigned Integers
      n = s.readU30();
      var uints = new Uint32Array(n);
      uints[0] = 0;
      for (var i = 1; i < n; i++) {
        uints[i] = s.readS32();
      }
      this.uints = uints;

      // Parse Doubles
      n = s.readU30();
      var doubles = new Float64Array(n);
      doubles[0] = NaN;
      for (var i = 1; i < n; i++) {
        doubles[i] = s.readDouble();
      }
      this.doubles = doubles;
    }

    private _parseStringConstants() {
      var n = 0, s = this._stream;
      n = s.readU30();
      this._strings = new Array(n);
      this._strings[0] = null;

      // Record the offset of each string in |stringOffsets|. This array has one extra
      // element so that we can compute the length of the last string.
      var stringOffsets = this._stringOffsets = new Uint32Array(n);
      stringOffsets[0] = -1;
      for (var i = 1; i < n; i++) {
        stringOffsets[i] = s.position;
        s.advance(s.readU30());
      }
    }

    private _parseNamespaces() {
      var s = this._stream;
      var n = s.readU30();
      this._namespaces = new Array(n);
      var namespaceOffsets = this._namespaceOffsets = new Uint32Array(n);
      namespaceOffsets[0] = -1;
      for (var i = 1; i < n; i++) {
        namespaceOffsets[i] = s.position;
        s.readU8(); // Kind
        s.readU30(); // String
      }
    }

    private _parseNamespaceSets() {
      var s = this._stream;
      var n = s.readU30();
      this._namespaceSets = new Array(n);
      var namespaceSetOffsets = this._namespaceSetOffsets = new Uint32Array(n);
      namespaceSetOffsets[0] = -1;
      for (var i = 1; i < n; i++) {
        namespaceSetOffsets[i] = s.position;
        var c = s.readU30(); // Count
        for (var j = 0; j < c; j++) {
          s.readU30(); // Namespace
        }
      }
    }

    private _consumeMultiname() {
      var s = this._stream;
      var kind = s.readU8();
      switch (kind) {
        case CONSTANT.QName: case CONSTANT.QNameA:
          s.readU30();
          s.readU30();
          break;
        case CONSTANT.RTQName: case CONSTANT.RTQNameA:
          s.readU30();
          break;
        case CONSTANT.RTQNameL: case CONSTANT.RTQNameLA:
          break;
        case CONSTANT.Multiname: case CONSTANT.MultinameA:
          s.readU30();
          s.readU30();
          break;
        case CONSTANT.MultinameL: case CONSTANT.MultinameLA:
          s.readU30();
          break;
        case CONSTANT.TypeName:
          s.readU32();
          var typeParameterCount = s.readU32();
          release || assert(typeParameterCount === 1); // This is probably the number of type parameters.
          s.readU32();
          break;
        default:
          Shumway.Debug.unexpected(kind);
          break;
      }
    }

    private _parseMultinames() {
      var s = this._stream;
      var n = s.readU30();
      this._multinames = new Array(n);
      var multinameOffsets = this._multinameOffsets = new Uint32Array(n);
      multinameOffsets[0] = -1;
      for (var i = 1; i < n; i++) {
        multinameOffsets[i] = s.position;
        this._consumeMultiname();
      }
    }

    private _parseMultiname(i: number): Multiname {
      var stream = this._stream;

      var namespaceIsRuntime = false;
      var namespaceIndex;
      var useNamespaceSet = true;
      var nameIndex = 0;

      var kind = stream.readU8();
      switch (kind) {
        case CONSTANT.QName:
        case CONSTANT.QNameA:
          namespaceIndex = stream.readU30();
          useNamespaceSet = false;
          nameIndex = stream.readU30();
          break;
        case CONSTANT.RTQName: case CONSTANT.RTQNameA:
          namespaceIsRuntime = true;
          nameIndex = stream.readU30();
          break;
        case CONSTANT.RTQNameL: case CONSTANT.RTQNameLA:
          namespaceIsRuntime = true;
          break;
        case CONSTANT.Multiname: case CONSTANT.MultinameA:
          nameIndex = stream.readU30();
          namespaceIndex = stream.readU30();
          break;
        case CONSTANT.MultinameL: case CONSTANT.MultinameLA:
          namespaceIndex = stream.readU30();
          if (!release && namespaceIndex === 0) {
            // TODO: figure out what to do in this case. What would Tamarin do?
            Debug.warning("Invalid multiname: namespace-set index is 0");
          }
          break;
        /**
         * This is undocumented, looking at Tamarin source for this one.
         */
        case CONSTANT.TypeName:
          var mn = stream.readU32();
          var typeParameterCount = stream.readU32();
          if (!release && typeParameterCount !== 1) {
            // TODO: figure out what to do in this case. What would Tamarin do?
            Debug.warning("Invalid multiname: bad type parameter count " + typeParameterCount);
          }
          var typeParameter = this.getMultiname(stream.readU32());
          var factory = this.getMultiname(mn);
          return new Multiname(this, i, kind, factory.namespaces, factory.name, typeParameter);
        default:
          Shumway.Debug.unexpected();
          break;
      }

      // A name index of 0 means that it's a runtime name.
      var name = nameIndex === 0 ? null : this.getString(nameIndex);
      var namespaces;
      if (namespaceIsRuntime) {
        namespaces = null;
      } else {
        namespaces = useNamespaceSet ?
                     this.getNamespaceSet(namespaceIndex) :
                     [this.getNamespace(namespaceIndex)];
      }

      return new Multiname(this, i, kind, namespaces, name);
    }

    private _checkMagic() {
      var magic = this._stream.readWord();
      var flashPlayerBrannan = 46 << 16 | 15;
      if (magic < flashPlayerBrannan) {
        throw new Error("Invalid ABC File (magic = " + Number(magic).toString(16) + ")");
      }
    }

    /**
     * String duplicates exist in practice but are extremely rare.
     */
    private _checkForDuplicateStrings(): boolean {
      var a = [];
      for (var i = 0; i < this._strings.length; i++) {
        a.push(this.getString(i));
      }
      a.sort();
      for (var i = 0; i < a.length - 1; i++) {
        if (a[i] === a[i + 1]) {
          return true;
        }
      }
      return false;
    }

    /**
     * Returns the string at the specified index in the string table.
     */
    public getString(i: number): string {
      release || assert(i >= 0 && i < this._stringOffsets.length);
      var str = this._strings[i];
      if (str === undefined) {
        var s = this._stream;
        s.seek(this._stringOffsets[i]);
        var l = s.readU30();
        str = this._strings[i] = s.readUTFString(l);
      }
      return str;
    }

    /**
     * Returns the multiname at the specified index in the multiname table.
     */
    public getMultiname(i: number): Multiname {
      release || assert(i >= 0 && i < this._multinameOffsets.length);
      if (i === 0) {
        return null;
      }
      var mn = this._multinames[i];
      if (mn === undefined) {
        var s = this._stream;
        s.seek(this._multinameOffsets[i]);
        mn = this._multinames[i] = this._parseMultiname(i);
      }
      return mn;
    }

    /**
     * Returns the namespace at the specified index in the namespace table.
     */
    public getNamespace(i: number): Namespace {
      release || assert(i >= 0 && i < this._namespaceOffsets.length);
      if (i === 0) {
        return null;
      }
      var ns = this._namespaces[i];
      if (ns === undefined) {
        var s = this._stream;
        s.seek(this._namespaceOffsets[i]);
        var kind = s.readU8();
        var name = this.getString(s.readU30());
        ns = this._namespaces[i] = new Namespace(this, kind, name);
      }
      return ns;
    }

    /**
     * Returns the namespace set at the specified index in the namespace set table.
     */
    public getNamespaceSet(i: number): Namespace [] {
      release || assert(i >= 0 && i < this._namespaceSets.length);
      if (i === 0) {
        return null;
      }
      var nss = this._namespaceSets[i];
      if (nss === undefined) {
        var s = this._stream;
        var o = this._namespaceSetOffsets[i];
        s.seek(o);
        var c = s.readU30(); // Count
        nss = this._namespaceSets[i] = new Array(c);
        o = s.position;
        for (var j = 0; j < c; j++) {
          s.seek(o);
          var x = s.readU30();
          o = s.position; // The call to |getNamespace| can change our current position.
          nss[j] = this.getNamespace(x);
        }
      }
      return nss;
    }

    private _parseMethodInfos() {
      var s = this._stream;
      var n = s.readU30();
      this._methods = new Array(n);
      this._methodInfoOffsets = new Uint32Array(n);
      for (var i = 0; i < n; ++i) {
        this._methodInfoOffsets[i] = s.position;
        this._consumeMethodInfo();
      }
    }

    private _consumeMethodInfo() {
      var s = this._stream;
      var parameterCount = s.readU30();
      s.readU30(); // Return Type
      var parameterOffset = s.position;
      for (var i = 0; i < parameterCount; i++) {
        s.readU30();
      }
      var nm = s.readU30();
      var flags = s.readU8();
      if (flags & METHOD.HasOptional) {
        var optionalCount = s.readU30();
        release || assert(parameterCount >= optionalCount);
        for (var i = parameterCount - optionalCount; i < parameterCount; i++) {
          s.readU30(); // Value Index
          s.readU8(); // Value Kind
        }
      }
      if (flags & METHOD.HasParamNames) {
        for (var i = 0; i < parameterCount; i++) {
          s.readU30();
        }
      }
    }

    private _parseMethodInfo(j: number) {
      var s = this._stream;
      var parameterCount = s.readU30();
      var returnType = s.readU30();
      var parameterOffset = s.position;
      var parameters = new Array<ParameterInfo>(parameterCount);
      for (var i = 0; i < parameterCount; i++) {
        parameters[i] = new ParameterInfo(this, s.readU30(), 0, -1, -1);
      }
      var name = s.readU30();
      var flags = s.readU8();
      if (flags & METHOD.HasOptional) {
        var optionalCount = s.readU30();
        release || assert(parameterCount >= optionalCount);
        for (var i = parameterCount - optionalCount; i < parameterCount; i++) {
          parameters[i].optionalValueIndex = s.readU30();
          parameters[i].optionalValueKind = s.readU8();
        }
      }
      if (flags & METHOD.HasParamNames) {
        for (var i = 0; i < parameterCount; i++) {
          // NOTE: We can't get the parameter name as described in the spec because some SWFs have
          // invalid parameter names. Tamarin ignores parameter names and so do we.
          parameters[i].name = s.readU30();
        }
      }
      return new MethodInfo(this, j, name, returnType, parameters, optionalCount, flags);
    }

    /**
     * Returns the method info at the specified index in the method info table.
     */
    public getMethodInfo(i: number) {
      release || assert(i >= 0 && i < this._methodInfoOffsets.length);
      var mi = this._methods[i];
      if (mi === undefined) {
        var s = this._stream;
        s.seek(this._methodInfoOffsets[i]);
        mi = this._methods[i] = this._parseMethodInfo(i);
      }
      return mi;
    }

    public getMethodBodyInfo(i: number) {
      return this._methodBodies[i];
    }

    private _parseMetaData() {
      var s = this._stream;
      var n = s.readU30();
      this._metadata = new Array(n);
      var metadataInfoOffsets = this._metadataInfoOffsets = new Uint32Array(n);
      for (var i = 0; i < n; i++) {
        metadataInfoOffsets[i] = s.position;
        s.readU30(); // Name
        var itemCount = s.readU30(); // Item Count
        for (var j = 0; j < itemCount; j++) {
          s.readU30();
          s.readU30();
        }
      }
    }

    public getMetadataInfo(i: number): MetadataInfo {
      release || assert(i >= 0 && i < this._metadata.length);
      var mi = this._metadata[i];
      if (mi === undefined) {
        var s = this._stream;
        s.seek(this._metadataInfoOffsets[i]);
        var name = s.readU30(); // Name
        var itemCount = s.readU30(); // Item Count
        var keys = new Uint32Array(itemCount);
        for (var j = 0; j < itemCount; j++) {
          keys[j] = s.readU30();
        }
        var values = new Uint32Array(itemCount);
        for (var j = 0; j < itemCount; j++) {
          values[j] = s.readU30();
        }
        mi = this._metadata[i] = new MetadataInfo(this, name, keys, values);
      }
      return mi;
    }

    private _parseInstanceAndClassInfos() {
      var s = this._stream;
      var n = s.readU30();
      var instances = this.instances = new Array(n);
      for (var i = 0; i < n; i++) {
        instances[i] = this._parseInstanceInfo();
      }
      this._parseClassInfos(n);
      var o = s.position;
      for (var i = 0; i < n; i++) {
        instances[i].classInfo = this.classes[i];
      }
      s.seek(o);
    }

    private _parseInstanceInfo(): InstanceInfo {
      var s = this._stream;
      var name = s.readU30();
      var superName = s.readU30();
      var flags = s.readU8();
      var protectedNs = 0;
      if (flags & CONSTANT.ClassProtectedNs) {
        protectedNs = s.readU30();
      }
      var interfaceCount = s.readU30();
      var interfaces = [];
      for (var i = 0; i < interfaceCount; i++) {
        interfaces[i] = s.readU30();
      }
      var initializer = s.readU30();
      var traits = this._parseTraits();
      var instanceInfo = new InstanceInfo(this, name, superName, flags, protectedNs, interfaces, initializer, traits);
      traits.attachHolder(instanceInfo);
      return instanceInfo;
    }

    private _parseTraits() {
      var s = this._stream;
      var n = s.readU30();
      var traits = [];
      for (var i = 0; i < n; i++) {
        traits.push(this._parseTrait());
      }
      return new Traits(traits);
    }

    private _parseTrait() {
      var s = this._stream;
      var name = s.readU30();
      var tag = s.readU8();

      var kind = tag & 0x0F;
      var attributes = (tag >> 4) & 0x0F;

      var trait: TraitInfo;
      switch (kind) {
        case TRAIT.Slot:
        case TRAIT.Const:
          var slot = s.readU30();
          var type = s.readU30();
          var valueIndex = s.readU30();
          var valueKind = -1;
          if (valueIndex !== 0) {
            valueKind = s.readU8();
          }
          trait = new SlotTraitInfo(this, kind, name, slot, type, valueKind, valueIndex);
          break;
        case TRAIT.Method:
        case TRAIT.Setter:
        case TRAIT.Getter:
          var dispID = s.readU30(); // Tamarin optimization.
          var methodInfoIndex = s.readU30();
          var o = s.position;
          var methodInfo = this.getMethodInfo(methodInfoIndex);
          trait = methodInfo.trait = new MethodTraitInfo(this, kind, name, methodInfo);
          s.seek(o);
          break;
        case TRAIT.Class:
          var slot = s.readU30();
          var classInfo = this.classes[s.readU30()];
          trait = classInfo.trait = new ClassTraitInfo(this, kind, name, slot, classInfo);
          break;
        default:
          release || assert(false, "Unknown trait kind: " + TRAIT[kind] + " " + kind);
      }

      if (attributes & ATTR.Metadata) {
        var n = s.readU30();
        var metadata = new Uint32Array(n);
        for (var i = 0; i < n; i++) {
          metadata[i] = s.readU30();
        }
        trait.metadata = metadata;
      }
      return trait;
    }

    private _parseClassInfos(n: number) {
      var s = this._stream;
      var classes = this.classes = new Array(n);
      for (var i = 0; i < n; i++) {
        classes[i] = this._parseClassInfo(i);
      }
    }

    private _parseClassInfo(i: number) {
      var s = this._stream;
      var initializer = s.readU30();
      var traits = this._parseTraits();
      var classInfo = new ClassInfo(this, this.instances[i], initializer, traits);
      traits.attachHolder(classInfo);
      return classInfo;
    }

    private _parseScriptInfos() {
      var s = this._stream;
      var n = s.readU30();
      var scripts = this.scripts = new Array(n);
      for (var i = 0; i < n; i++) {
        scripts[i] = this._parseScriptInfo();
      }
    }

    private _parseScriptInfo() {
      var s = this._stream;
      var initializer = s.readU30();
      var traits = this._parseTraits();
      var scriptInfo = new ScriptInfo(this, initializer, traits);
      traits.attachHolder(scriptInfo);
      return scriptInfo;
    }

    private _parseMethodBodyInfos() {
      var s = this._stream;
      var methodBodies = this._methodBodies = new Array(this._methods.length);
      var n = s.readU30();
      var o = s.position;
      for (var i = 0; i < n; i++) {
        var methodInfo = s.readU30();
        var maxStack = s.readU30();
        var localCount = s.readU30();
        var initScopeDepth = s.readU30();
        var maxScopeDepth = s.readU30();
        var code = s.viewU8s(s.readU30());

        var e = s.readU30();
        var exceptions = new Array(e);
        for (var j = 0; j < e; ++j) {
          exceptions[i] = this._parseException();
        }
        var traits = this._parseTraits();
        methodBodies[methodInfo] = new MethodBodyInfo(maxStack, localCount, initScopeDepth, maxScopeDepth, code, exceptions, traits);
        traits.attachHolder(methodBodies[methodInfo]);
      }
    }

    private _parseException() {
      var s = this._stream;
      var start = s.readU30();
      var end = s.readU30();
      var target = s.readU30();
      var type = s.readU30();
      var varName = s.readU30();
      return new ExceptionInfo(start, end, target, type, varName);
    }

    public getConstant(kind: CONSTANT, i: number): any {
      switch (kind) {
        case CONSTANT.Int:
          return this.ints[i];
        case CONSTANT.UInt:
          return this.uints[i];
        case CONSTANT.Double:
          return this.doubles[i];
        case CONSTANT.Utf8:
          return this.getString(i);
        case CONSTANT.True:
          return true;
        case CONSTANT.False:
          return false;
        case CONSTANT.Null:
          return null;
        case CONSTANT.Undefined:
          return undefined;
        case CONSTANT.Namespace:
        case CONSTANT.PackageInternalNs:
          return this.getNamespace(i);
        case CONSTANT.QName:
        case CONSTANT.MultinameA:
        case CONSTANT.RTQName:
        case CONSTANT.RTQNameA:
        case CONSTANT.RTQNameL:
        case CONSTANT.RTQNameLA:
        case CONSTANT.NameL:
        case CONSTANT.NameLA:
          return this.getMultiname(i);
        case CONSTANT.Float:
          Shumway.Debug.warning("TODO: CONSTANT.Float may be deprecated?");
          break;
        default:
          release || assert(false, "Not Implemented Kind " + kind);
      }
    }

    stress() {
      for (var i = 0; i < this._multinames.length; i++) {
        this.getMultiname(i);
      }
      for (var i = 0; i < this._namespaceSets.length; i++) {
        this.getNamespaceSet(i);
      }
      for (var i = 0; i < this._namespaces.length; i++) {
        this.getNamespace(i);
      }
      for (var i = 0; i < this._strings.length; i++) {
        this.getString(i);
      }
    }

    trace(writer: IndentingWriter) {
      return false;

      for (var i = 0; i < this._methodBodies.length; i++) {
        var methodBody = this._methodBodies[i];
        if (methodBody) {
          try {
            var stream = new BytecodeStream(methodBody.code);
            while (stream.currentBytecode() !== Bytecode.END) {
              stream.next();
            }
          } catch (e) {
            writer.errorLn("Corrupt: " + e);
          }
        }
      }

      writer.writeLn("");
      writer.writeLn("");

      writer.writeLn("Multinames: " + this._multinames.length);
      writer.writeLn("Namespace Sets: " + this._namespaceSets.length);
      writer.writeLn("Namespaces: " + this._namespaces.length);
      writer.writeLn("Strings: " + this._strings.length);
      writer.writeLn("Methods: " + this._methods.length);
      writer.writeLn("InstanceInfos: " + this.instances.length);
      writer.writeLn("ClassInfos: " + this.classes.length);
      writer.writeLn("ScriptInfos: " + this.scripts.length);

      writer.writeLn("");

      writer.writeLn("Multinames: " + this._multinames.length);
      if (false) {
        writer.indent();
        for (var i = 0; i < this._multinames.length; i++) {
          writer.writeLn(i + " " + this.getMultiname(i));
        }
        writer.outdent();
      }

      writer.writeLn("Namespace Sets: " + this._namespaceSets.length);
      if (false) {
        writer.indent();
        for (var i = 0; i < this._namespaceSets.length; i++) {
          writer.writeLn(i + " " + this.getNamespaceSet(i));
        }
        writer.outdent();
      }

      writer.writeLn("Namespaces: " + this._namespaces.length);
      if (false) {
        writer.indent();
        for (var i = 0; i < this._namespaces.length; i++) {
          writer.writeLn(i + " " + this.getNamespace(i));
        }
        writer.outdent();
      }

      writer.writeLn("Strings: " + this._strings.length);
      if (false) {
        writer.indent();
        for (var i = 0; i < this._strings.length; i++) {
          writer.writeLn(i + " " + this.getString(i));
        }
        writer.outdent();
      }

      writer.writeLn("MethodInfos: " + this._methods.length);
      if (true) {
        writer.indent();
        for (var i = 0; i < this._methods.length; i++) {
          writer.writeLn(i + " " + this.getMethodInfo(i));
          if (this._methodBodies[i]) {
            this._methodBodies[i].trace(writer);
          }
        }
        writer.outdent();
      }

      writer.writeLn("InstanceInfos: " + this.instances.length);
      if (false) {
        writer.indent();
        for (var i = 0; i < this.instances.length; i++) {
          writer.writeLn(i + " " + this.instances[i]);
          this.instances[i].trace(writer);
        }
        writer.outdent();
      }

      writer.writeLn("ClassInfos: " + this.classes.length);
      if (false) {
        writer.indent();
        for (var i = 0; i < this.classes.length; i++) {
          this.classes[i].trace(writer);
        }
        writer.outdent();
      }

      writer.writeLn("ScriptInfos: " + this.scripts.length);
      if (false) {
        writer.indent();
        for (var i = 0; i < this.scripts.length; i++) {
          this.scripts[i].trace(writer);
        }
        writer.outdent();
      }
    }
  }
}