import React from "react";

// Keep a player/render failure inside the stage: the room connection, chat and
// source picker remain usable. The parent resets this boundary on retry/source.
export class PlayerBoundary extends React.Component<
  {
    children: React.ReactNode;
    onFailure: () => void;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? (
      <div className="provider-loading" role="alert">
        The player could not start. Retry the source below or choose another
        song.
      </div>
    ) : (
      this.props.children
    );
  }
}
