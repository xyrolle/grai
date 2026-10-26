import { categoriesOf, type PluralType } from "../plurals.ts";
import { pluralLocal, untaken } from "./converted.ts";

/**
 * The locals an ICU message's choices count with, each declared the first time a choice needs it,
 * under a name the message's inputs and other locals do not take.
 */
export class IcuLocals {
	readonly declarations: string[] = [];
	private readonly locale: string;
	private readonly inputs: ReadonlySet<string>;
	/** Each local's name, by what it holds, such as `cardinal count`. */
	private readonly names = new Map<string, string>();
	/** The type of rules each local chooses by, by its name. */
	private readonly types = new Map<string, PluralType>();

	constructor(locale: string, inputs: ReadonlySet<string>) {
		this.locale = locale;
		this.inputs = inputs;
	}

	/** The local that holds an input's category of a type. */
	plural(input: string, type: PluralType): string {
		return (
			this.names.get(`${type} ${input}`) ??
			this.declareLocal(
				`${type} ${input}`,
				pluralLocal(input, type, this.taken()),
				type,
			)
		);
	}

	/**
	 * The local that holds an input less an ICU plural's offset, which its categories and `#` read:
	 * MessageFormat 2's `:offset`, such as `local countOffset = count: offset subtract=1`. A
	 * negative offset adds.
	 */
	offset(input: string, offset: number): string {
		const id = `offset ${offset} ${input}`;
		const known = this.names.get(id);
		if (known !== undefined) return known;
		const name = untaken(`${input}Offset`, this.taken());
		const option = offset > 0 ? `subtract=${offset}` : `add=${-offset}`;
		const declaration = `local ${name} = ${input}: offset ${option}`;
		return this.declareLocal(id, { name, declaration }, "cardinal");
	}

	/** Declares a local, which chooses by the rules of a type. */
	private declareLocal(
		id: string,
		local: { name: string; declaration: string },
		type: PluralType,
	): string {
		this.names.set(id, local.name);
		this.types.set(local.name, type);
		this.declarations.push(local.declaration);
		return local.name;
	}

	private taken(): ReadonlySet<string> {
		return new Set([...this.inputs, ...this.types.keys()]);
	}

	/** The categories a selector takes when it is a local, which are all it can take. */
	categoriesOf(selector: string): readonly string[] | undefined {
		const type = this.types.get(selector);
		return type === undefined ? undefined : categoriesOf(this.locale, type);
	}
}
