/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDimension } from 'vs/base/browser/dom';
import { Disposable, DisposableStore, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { IObservable, ISettableObservable, autorun, autorunHandleChanges, observableFromEvent, observableValue, transaction } from 'vs/base/common/observable';
import { ElementSizeObserver } from 'vs/editor/browser/config/elementSizeObserver';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IModelDeltaDecoration } from 'vs/editor/common/model';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

export function joinCombine<T>(arr1: readonly T[], arr2: readonly T[], keySelector: (val: T) => number, combine: (v1: T, v2: T) => T): readonly T[] {
	if (arr1.length === 0) {
		return arr2;
	}
	if (arr2.length === 0) {
		return arr1;
	}

	const result: T[] = [];
	let i = 0;
	let j = 0;
	while (i < arr1.length && j < arr2.length) {
		const val1 = arr1[i];
		const val2 = arr2[j];
		const key1 = keySelector(val1);
		const key2 = keySelector(val2);

		if (key1 < key2) {
			result.push(val1);
			i++;
		} else if (key1 > key2) {
			result.push(val2);
			j++;
		} else {
			result.push(combine(val1, val2));
			i++;
			j++;
		}
	}
	while (i < arr1.length) {
		result.push(arr1[i]);
		i++;
	}
	while (j < arr2.length) {
		result.push(arr2[j]);
		j++;
	}
	return result;
}

// TODO make utility
export function applyObservableDecorations(editor: ICodeEditor, decorations: IObservable<IModelDeltaDecoration[]>): IDisposable {
	const d = new DisposableStore();
	const decorationsCollection = editor.createDecorationsCollection();
	d.add(autorun(`Apply decorations from ${decorations.debugName}`, reader => {
		const d = decorations.read(reader);
		decorationsCollection.set(d);
	}));
	d.add({
		dispose: () => {
			decorationsCollection.clear();
		}
	});
	return d;
}

export function appendRemoveOnDispose(parent: HTMLElement, child: HTMLElement) {
	parent.appendChild(child);
	return toDisposable(() => {
		parent.removeChild(child);
	});
}

export function observableConfigValue<T>(key: string, defaultValue: T, configurationService: IConfigurationService): IObservable<T> {
	return observableFromEvent(
		(handleChange) => configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(key)) {
				handleChange(e);
			}
		}),
		() => configurationService.getValue<T>(key) ?? defaultValue,
	);
}

export class ObservableElementSizeObserver extends Disposable {
	private readonly elementSizeObserver: ElementSizeObserver;

	private readonly _width: ISettableObservable<number>;
	public get width(): ISettableObservable<number> { return this._width; }

	private readonly _height: ISettableObservable<number>;
	public get height(): ISettableObservable<number> { return this._height; }

	constructor(element: HTMLElement | null, dimension: IDimension | undefined) {
		super();

		this.elementSizeObserver = this._register(new ElementSizeObserver(element, dimension));
		this._width = observableValue('width', this.elementSizeObserver.getWidth());
		this._height = observableValue('height', this.elementSizeObserver.getHeight());

		this._register(this.elementSizeObserver.onDidChange(e => transaction(tx => {
			this._width.set(this.elementSizeObserver.getWidth(), tx);
			this._height.set(this.elementSizeObserver.getHeight(), tx);
		})));
	}

	public observe(dimension?: IDimension): void {
		this.elementSizeObserver.observe(dimension);
	}

	public setAutomaticLayout(automaticLayout: boolean): void {
		if (automaticLayout) {
			this.elementSizeObserver.startObserving();
		} else {
			this.elementSizeObserver.stopObserving();
		}
	}
}

export function animatedObservable(base: IObservable<number, boolean>, store: DisposableStore): IObservable<number> {
	let targetVal = base.get();
	let startVal = targetVal;
	let curVal = targetVal;
	const result = observableValue('animatedValue', targetVal);

	let animationStartMs: number = -1;
	const durationMs = 300;
	let animationFrame: number | undefined = undefined;

	store.add(autorunHandleChanges('update value', {
		createEmptyChangeSummary: () => ({ animate: false }),
		handleChange: (ctx, s) => {
			if (ctx.didChange(base)) {
				s.animate = s.animate || ctx.change;
			}
			return true;
		}
	}, (reader, s) => {
		if (animationFrame !== undefined) {
			cancelAnimationFrame(animationFrame);
			animationFrame = undefined;
		}

		startVal = curVal;
		targetVal = base.read(reader);
		animationStartMs = Date.now() - (s.animate ? 0 : durationMs);

		update();
	}));

	function update() {
		const passedMs = Date.now() - animationStartMs;
		curVal = Math.floor(easeOutExpo(passedMs, startVal, targetVal - startVal, durationMs));

		if (passedMs < durationMs) {
			animationFrame = requestAnimationFrame(update);
		} else {
			curVal = targetVal;
		}

		result.set(curVal, undefined);
	}

	return result;
}

function easeOutExpo(t: number, b: number, c: number, d: number): number {
	return t === d ? b + c : c * (-Math.pow(2, -10 * t / d) + 1) + b;
}

export function deepMerge<T extends {}>(source1: T, source2: Partial<T>): T {
	const result = {} as T;
	for (const key in source1) {
		result[key] = source1[key];
	}
	for (const key in source2) {
		const source2Value = source2[key];
		if (typeof result[key] === 'object' && source2Value && typeof source2Value === 'object') {
			result[key] = deepMerge<any>(result[key], source2Value);
		} else {
			result[key] = source2Value as any;
		}
	}
	return result;
}
