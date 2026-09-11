import { Component, Input, Output, EventEmitter } from "@angular/core";
@Component({ selector: "app-profile-card", templateUrl: "./profile-card.component.html" })
export class ProfileCardComponent { @Input() user: any; @Output() edit = new EventEmitter<void>(); }
