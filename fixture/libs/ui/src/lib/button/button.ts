import { Component, output, Input } from "@angular/core";
@Component({ selector: "ui-button, [uiButton]", template: `<button (click)="clicked.emit()"><ng-content /></button>` })
export class UiButton { @Input() variant = "primary"; clicked = output<void>(); }
