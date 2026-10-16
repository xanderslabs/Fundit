import { useEffect, useState, useRef } from "react";
import PropTypes from "prop-types";

function InfiniteImageSlider({
  folderPath,
  numberOfImages,
  imageExtension = "png",
}) {
  const [loadedImages, setLoadedImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [animationPaused, setAnimationPaused] = useState(false);
  const sliderReference = useRef(null);

  // Inject slider CSS if it hasn't been added yet
  useEffect(() => {
    if (!document.querySelector("#slider-styles")) {
      const styleSheet = document.createElement("style");
      styleSheet.id = "slider-styles";
      styleSheet.textContent = `
        .ptn-cont {
          width: 100%;
          margin: 20px 0;
          overflow: hidden;
          position: relative;
        }

        .ptn-slide {
          display: flex;
          gap: 40px;
          animation: scroll 180s linear infinite;
        }

        .ptn-img {
          height: 60px;
          width: auto;
          flex-shrink: 0;
        }

        .ptn-img img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          -webkit-filter: grayscale(100%);
          filter: grayscale(100%);
        }

        @keyframes scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(calc(-200px * var(--slide-count)));
          }
        }

        .slider-error {
          color: red;
          text-align: center;
          padding: 20px;
        }

        .slider-loading {
          text-align: center;
          padding: 20px;
        }
      `;
      document.head.append(styleSheet);
    }
  }, []);

  // Preload images and update component state
  useEffect(() => {
    // Ensure folderPath starts with a "/"
    const normalizedFolderPath = folderPath.startsWith("/")
      ? folderPath
      : "/" + folderPath;

    const imageSources = Array.from(
      { length: numberOfImages },
      (_, i) => `${normalizedFolderPath}/image${i + 1}.${imageExtension}`,
    );

    // Preload each image and wait for all to either load or error out
    const preloadPromises = imageSources.map(
      (source) =>
        new Promise((resolve) => {
          const img = new Image();
          img.addEventListener("load", () =>
            resolve({ src: source, success: true }),
          );
          img.onerror = () => {
            console.warn(`Failed to load image: ${source}`);
            resolve({ src: source, success: false });
          };

          img.src = source;
        }),
    );

    Promise.all(preloadPromises)
      .then((results) => {
        const validImages = results
          .filter((result) => result.success)
          .map((result) => result.src);
        if (validImages.length === 0) {
          setError("No images could be loaded. Please check the image paths.");
        }

        setLoadedImages(validImages);
        // Update the CSS variable to be used in the animation
        document.documentElement.style.setProperty(
          "--slide-count",
          validImages.length,
        );
        setLoading(false);
      })
      .catch((error_) => {
        console.error("Error preloading images:", error_);
        setError("Error loading images. Please check the console for details.");
        setLoading(false);
      });
  }, [folderPath, numberOfImages, imageExtension]);

  // Calculate how many copies of the images are needed to fill the screen smoothly.
  // The original logic used window.innerWidth and assumed each image is 200px wide.
  const copiesNeeded =
    loadedImages.length > 0
      ? Math.ceil(window.innerWidth / (200 * loadedImages.length)) + 1
      : 0;

  if (loading) {
    return;
  }

  if (error) {
    return <div className="slider-error">{error}</div>;
  }

  return (
    <div className="ptn-cont">
      <div
        className="ptn-slide"
        ref={sliderReference}
        style={{ animationPlayState: animationPaused ? "paused" : "running" }}
        onMouseEnter={() => setAnimationPaused(true)}
        onMouseLeave={() => setAnimationPaused(false)}
      >
        {Array.from({ length: copiesNeeded }).map((_, copyIndex) =>
          loadedImages.map((imgSource, imgIndex) => (
            <div key={`${copyIndex}-${imgIndex}`} className="ptn-img">
              <img src={imgSource} alt="" />
            </div>
          )),
        )}
      </div>
    </div>
  );
}

InfiniteImageSlider.propTypes = {
  folderPath: PropTypes.string.isRequired,
  numberOfImages: PropTypes.number.isRequired,
  imageExtension: PropTypes.string,
};

export default InfiniteImageSlider;
