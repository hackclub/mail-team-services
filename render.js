var pdfjsLib = require('pdfjs-dist');
var Canvas = require('canvas');
var assert = require('assert');
var fs = require('fs');

function NodeCanvasFactory() {}
NodeCanvasFactory.prototype = {
  create: function NodeCanvasFactory_create(width, height) {
    assert(width > 0 && height > 0, 'Invalid canvas size');
    var canvas = Canvas.createCanvas(width, height);
    var context = canvas.getContext('2d');
    return {
      canvas: canvas,
      context: context,
    };
  },

  reset: function NodeCanvasFactory_reset(canvasAndContext, width, height) {
    assert(canvasAndContext.canvas, 'Canvas is not specified');
    assert(width > 0 && height > 0, 'Invalid canvas size');
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  },

  destroy: function NodeCanvasFactory_destroy(canvasAndContext) {
    assert(canvasAndContext.canvas, 'Canvas is not specified');

    // Zeroing the width and height cause Firefox to release graphics
    // resources immediately, which can greatly reduce memory consumption.
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  },
};

module.exports = async function(pdf, pageIndex) {
  // Read the PDF file into a typed array so PDF.js can load it.
  var rawData = new Uint8Array(pdf);

  // Load the PDF file.
  var loadingTask = pdfjsLib.getDocument({data: rawData, disableFontFace: false});
  var pdfDocument = await loadingTask.promise
  
  // Get the first page.
  var page = await pdfDocument.getPage(pageIndex)
  
  // Render the page on a Node canvas with 100% scale.
  var viewport = page.getViewport({ scale: 4.0, });
  var canvasFactory = new NodeCanvasFactory();
  var canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
  var renderContext = {
    canvasContext: canvasAndContext.context,
    viewport: viewport,
    canvasFactory: canvasFactory,
  };

  var renderTask = page.render(renderContext);
  await renderTask.promise
  
  var image = canvasAndContext.canvas.toBuffer();
  return image
}