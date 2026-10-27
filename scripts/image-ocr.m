#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>

static void output(NSDictionary *value) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
    puts([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
}

static NSDictionary *ocrImage(NSString *filePath) {
    // Read image file
    NSImage *image = [[NSImage alloc] initWithContentsOfFile:filePath];
    if (!image) {
        return @{ @"file": filePath, @"error": @"Image file not found or invalid" };
    }

    // Convert to CGImage
    CGSize size = image.size;
    if (size.width <= 0 || size.height <= 0) {
        return @{ @"file": filePath, @"error": @"Invalid image dimensions" };
    }

    NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithData:
        [image TIFFRepresentation]];
    if (!rep) {
        return @{ @"file": filePath, @"error": @"Cannot convert image" };
    }
    CGImageRef cgImage = rep.CGImage;
    if (!cgImage) {
        return @{ @"file": filePath, @"error": @"Cannot create CGImage" };
    }

    // Apple Vision OCR (fast, accurate for text)
    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.usesLanguageCorrection = YES;
    request.automaticallyDetectsLanguage = YES;
    NSString *ocrText = nil;
    NSString *visionError = nil;
    NSInteger lineCount = 0;

    NSError *visionErrorObj = nil;
    BOOL visionSuccess = [[[VNImageRequestHandler alloc] initWithCGImage:cgImage options:@{}]
        performRequests:@[request] error:&visionErrorObj];
    if (visionSuccess) {
        NSMutableArray<NSString *> *lines = [NSMutableArray array];
        for (VNRecognizedTextObservation *obs in request.results) {
            VNRecognizedText *candidate = [[obs topCandidates:1] firstObject];
            if (candidate.string && candidate.string.length > 0) {
                [lines addObject:candidate.string];
            }
        }
        ocrText = [lines componentsJoinedByString:@"\n"];
        lineCount = lines.count;
    } else {
        visionError = visionErrorObj.localizedDescription ?: @"Unknown";
    }

    // Return result - vision OCR text (may not capture formulas well)
    // The caller should also return the original image for Claude to interpret formulas
    return @{
        @"file": filePath,
        @"ocr_text": ocrText ?: @"",
        @"recognized_line_count": @(lineCount),
        @"vision_error": visionError ?: @"",
        // Note: original image is passed separately by the caller
    };
}

int main(int argc, const char *argv[]) {
    if (argc != 2) {
        output(@{ @"error": @"Expected exactly one image file path" });
        return 2;
    }

    @autoreleasepool {
        NSString *filePath = [NSString stringWithUTF8String:argv[1]];
        if (!filePath || filePath.length == 0) {
            output(@{ @"error": @"Empty file path" });
            return 2;
        }

        NSDictionary *result = ocrImage(filePath);
        output(result);
        return result[@"error"] ? 1 : 0;
    }
}
