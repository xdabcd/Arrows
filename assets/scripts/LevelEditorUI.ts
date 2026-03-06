import { _decorator, Component, Label, Button, Node } from 'cc';
import { LevelEditorBoard } from './LevelEditorBoard';
const { ccclass, property } = _decorator;

/**
 * 关卡编辑器 - 宽高调节 UI
 * 两个可上下调整的数字输入，限制在棋盘的 minWidth/maxWidth、minHeight/maxHeight 内。
 */
@ccclass('LevelEditorUI')
export class LevelEditorUI extends Component {

    @property(LevelEditorBoard)
    board: LevelEditorBoard | null = null;

    @property(Label)
    widthLabel: Label | null = null;

    @property(Label)
    heightLabel: Label | null = null;

    @property(Button)
    widthMinusBtn: Button | null = null;

    @property(Button)
    widthPlusBtn: Button | null = null;

    @property(Button)
    heightMinusBtn: Button | null = null;

    @property(Button)
    heightPlusBtn: Button | null = null;

    onLoad() {
        this._bindButtons();
        this.refreshLabels();
    }

    private _bindButtons(): void {
        if (this.widthMinusBtn) {
            this.widthMinusBtn.node.on(Button.EventType.CLICK, this._onWidthMinus, this);
        }
        if (this.widthPlusBtn) {
            this.widthPlusBtn.node.on(Button.EventType.CLICK, this._onWidthPlus, this);
        }
        if (this.heightMinusBtn) {
            this.heightMinusBtn.node.on(Button.EventType.CLICK, this._onHeightMinus, this);
        }
        if (this.heightPlusBtn) {
            this.heightPlusBtn.node.on(Button.EventType.CLICK, this._onHeightPlus, this);
        }
    }

    private _onWidthMinus(): void {
        if (!this.board) return;
        const w = Math.max(this.board.getMinWidth(), this.board.getWidth() - 1);
        this.board.setSize(w, this.board.getHeight());
        this.refreshLabels();
    }

    private _onWidthPlus(): void {
        if (!this.board) return;
        const w = Math.min(this.board.getMaxWidth(), this.board.getWidth() + 1);
        this.board.setSize(w, this.board.getHeight());
        this.refreshLabels();
    }

    private _onHeightMinus(): void {
        if (!this.board) return;
        const h = Math.max(this.board.getMinHeight(), this.board.getHeight() - 1);
        this.board.setSize(this.board.getWidth(), h);
        this.refreshLabels();
    }

    private _onHeightPlus(): void {
        if (!this.board) return;
        const h = Math.min(this.board.getMaxHeight(), this.board.getHeight() + 1);
        this.board.setSize(this.board.getWidth(), h);
        this.refreshLabels();
    }

    /** 根据当前棋盘尺寸更新宽高显示 */
    refreshLabels(): void {
        if (this.board) {
            if (this.widthLabel) this.widthLabel.string = String(this.board.getWidth());
            if (this.heightLabel) this.heightLabel.string = String(this.board.getHeight());
        }
    }
}
