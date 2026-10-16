import InfiniteImageSlider from "./ImageSlider.jsx";
// Adjust the import path as needed
function Partners() {
  return (
    <div className="partners">
      <InfiniteImageSlider
        folderPath="./assets/slider-imgs"
        numberOfImages={6}
        // ImageExtension is optional (defaults to "png")
      />
    </div>
  );
}

export default Partners;
