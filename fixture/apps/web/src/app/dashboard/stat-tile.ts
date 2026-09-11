import { Component, input } from "@angular/core";
@Component({ selector: "app-stat-tile", template: `<div class="rounded-lg border bg-card p-6 shadow">{{ value() }}</div>` })
export class StatTile { value = input<number>(0); }
