#import <React/RCTBridgeModule.h>

// Synthetic input for the Input DevTools panel and its agent tools. Debug builds only: it drives UIKit through private API.
@interface InputInjector : NSObject <RCTBridgeModule>
@end
