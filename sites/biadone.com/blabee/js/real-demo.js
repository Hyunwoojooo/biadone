const video = document.querySelector("#real-demo-video");
const playButton = document.querySelector(".real-demo-play");
const playLabel = document.querySelector("[data-video-play-label]");
const errorMessage = document.querySelector(".real-demo-error");

if (video && playButton && playLabel && errorMessage) {
  playButton.hidden = false;

  const showPlaybackError = () => {
    playButton.disabled = false;
    playLabel.textContent = "Try again";
    errorMessage.hidden = false;
  };

  playButton.addEventListener("click", async () => {
    playButton.disabled = true;
    playLabel.textContent = "Loading…";
    errorMessage.hidden = true;
    try {
      await video.play();
    } catch {
      showPlaybackError();
    }
  });

  video.addEventListener("playing", () => {
    if (document.activeElement === playButton) video.focus({ preventScroll: true });
    playButton.hidden = true;
    playButton.disabled = false;
    errorMessage.hidden = true;
  });

  video.addEventListener("ended", () => {
    playLabel.textContent = "Replay demo";
    playButton.hidden = false;
  });

  video.addEventListener("error", showPlaybackError);
}
