import { Component, input } from "@angular/core";
@Component({ selector: "ui-card", templateUrl: "./card.html" })
export class UiCard { title = input.required<string>(); elevated = input(false); }
