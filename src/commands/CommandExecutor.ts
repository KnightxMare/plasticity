import CommandRegistry from "../components/atom/CommandRegistry";
import { EditorSignals } from "../editor/EditorSignals";
import { EditorOriginator, History } from "../editor/History";
import { HasSelection } from "../selection/SelectionManager";
import { Cancel } from "../util/Cancellable";
import Command from "./Command";
import { SelectionCommandManager } from "./SelectionCommandManager";

export type CancelOrFinish = 'cancel' | 'finish';

export class CommandExecutor {
    constructor(
        private readonly selectionGizmo: SelectionCommandManager,
        private readonly registry: CommandRegistry,
        private readonly signals: EditorSignals,
        private readonly originator: EditorOriginator,
        private readonly history: History,
        private readonly selection: HasSelection,
    ) { }

    private active?: Command;
    private next?: Command;

    // Cancel any active commands and "enqueue" another.
    // Ensure commands are executed ATOMICALLY.
    // That is, do not start a new command until the previous is fully completed,
    // including any cancelation cleanup. (await this.execute(next))
    async enqueue(command: Command, cancelOrFinish: CancelOrFinish = 'cancel') {
        this.next = command;
        const isActive = !!this.active;
        if (cancelOrFinish === 'cancel') this.cancelActiveCommand();
        else if (cancelOrFinish === 'finish') this.finishActiveCommand();

        if (!isActive) await this.dequeue();
    }

    private async dequeue() {
        if (!this.next) throw new Error("Invalid precondition");

        let next!: Command;
        while (this.next) {
            next = this.next;
            if (this.active) throw new Error("invalid precondition");
            this.active = next;
            this.next = undefined;
            try {
                await this.execute(next);
                const command = this.selectionGizmo.commandFor(next);
                if (command !== undefined) await this.enqueue(command);
            } catch (e) {
                if (e !== Cancel) console.warn(e);
            } finally { delete this.active }
        }
    }

    private async execute(command: Command) {
        const disposable = this.registry.add('ispace-viewport', {
            'command:finish': () => command.finish(),
            'command:abort': () => command.cancel(),
        });
        const state = this.originator.saveToMemento(new Map());
        document.body.setAttribute("command", command.identifier);
        try {
            let selectionChanged = false;
            this.signals.objectSelected.addOnce(() => selectionChanged = true);
            this.signals.objectDeselected.addOnce(() => selectionChanged = true);
            await command.execute();
            command.finish();
            if (selectionChanged) this.signals.selectionChanged.dispatch({ selection: this.selection });
            this.history.add("Command", state);
        } catch (e) {
            command.cancel();
            throw e;
        } finally {
            document.body.removeAttribute("command");
            disposable.dispose();
        }
    }

    cancelActiveCommand() {
        const active = this.active;
        if (active) active.cancel();
    }

    private finishActiveCommand() {
        const active = this.active;
        if (active) active.finish();
    }

    async enqueueDefaultCommand() {
        const command = this.selectionGizmo.commandFor();
        if (command) await this.enqueue(command);
    }
}