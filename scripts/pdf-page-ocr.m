#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <PDFKit/PDFKit.h>
#import <Vision/Vision.h>

static void output(NSDictionary *value) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
    puts([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 4) { output(@{ @"error": @"Expected PDF path, zero-based page index and temporary image path" }); return 2; }
        NSString *number = [NSString stringWithUTF8String:argv[2]];
        NSScanner *scanner = [NSScanner scannerWithString:number];
        NSInteger pageIndex = -1;
        if (![scanner scanInteger:&pageIndex] || !scanner.isAtEnd || pageIndex < 0) {
            output(@{ @"error": @"Invalid PDF page index" }); return 2;
        }
        NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
        PDFDocument *document = [[PDFDocument alloc] initWithURL:url];
        PDFPage *page = [document pageAtIndex:pageIndex];
        if (!page) { output(@{ @"error": @"PDF could not be opened or page index is outside the document" }); return 2; }
        NSRect bounds = [page boundsForBox:kPDFDisplayBoxMediaBox];
        CGFloat longest = MAX(bounds.size.width, bounds.size.height);
        CGFloat scale = longest > 0 ? MIN(2.0, 1600.0 / longest) : 1.0;
        NSSize size = NSMakeSize(MAX(1, bounds.size.width * scale), MAX(1, bounds.size.height * scale));
        NSImage *thumbnail = [page thumbnailOfSize:size forBox:kPDFDisplayBoxMediaBox];
        CGImageRef image = [thumbnail CGImageForProposedRect:NULL context:nil hints:nil];
        if (!image) { output(@{ @"error": @"PDF page could not be rendered" }); return 2; }
        NSData *png = [[[NSBitmapImageRep alloc] initWithCGImage:image] representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        if (![png writeToFile:[NSString stringWithUTF8String:argv[3]] atomically:YES]) {
            output(@{ @"error": @"PDF page image could not be written" }); return 2;
        }
        VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
        request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
        request.usesLanguageCorrection = YES;
        request.automaticallyDetectsLanguage = YES;
        NSError *error = nil;
        BOOL success = [[[VNImageRequestHandler alloc] initWithCGImage:image options:@{}] performRequests:@[request] error:&error];
        NSMutableArray<NSString *> *lines = [NSMutableArray array];
        if (success) {
            for (VNRecognizedTextObservation *observation in request.results) {
                VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
                if (candidate.string) [lines addObject:candidate.string];
            }
        }
        output(@{ @"page_index": @(pageIndex), @"page_number": @(pageIndex + 1), @"page_count": @(document.pageCount),
                  @"pdf_page_label": page.label ?: @"", @"embedded_text": page.string ?: @"",
                  @"ocr_text": [lines componentsJoinedByString:@"\n"], @"recognized_line_count": @(lines.count),
                  @"vision_error": success ? @"" : (error.localizedDescription ?: @"unknown") });
        return 0;
    }
}
