import { categoriesOf, type PluralType } from "../plurals.ts";
import { pluralLocal } from "./converted.ts";

/**
 * The locals an ICU message's choices count with, each declared the first time a choice needs it,
 * under a name the message's inputs do not take.
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
		const id = `${type} ${input}`;
		const known = this.names.get(id);
		if (known !== undefined) return known;
		const local = pluralLocal(input, type, this.inputs);
		this.names.set(id, local.name);
		this.types.set(local.name, type);
		this.declarations.push(local.declaration);
		return local.name;
	}

	/** The categories a selector takes when it is a local, which are all it can take. */
	categoriesOf(selector: string): readonly string[] | undefined {
		const type = this.types.get(selector);
		return type === undefined ? undefined : categoriesOf(this.locale, type);
	}
}
