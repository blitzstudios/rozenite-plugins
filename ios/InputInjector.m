#import "InputInjector.h"

#if DEBUG

#import <UIKit/UIKit.h>
#import <objc/message.h>
#import <objc/runtime.h>

static const NSTimeInterval kTapHoldSeconds = 0.06;
static const NSTimeInterval kMoveStepSeconds = 1.0 / 60.0;
static const NSUInteger kMaxElements = 600;
static const NSUInteger kMaxViews = 1500;
static const NSUInteger kMaxViewText = 500;
static const NSUInteger kMaxGatheredText = 120;

@implementation InputInjector {
  // The windows a snapshot is walking, so each element's hit test doesn't list them again.
  NSArray<UIWindow *> *_walkWindows;
  // Hit test results for the panel, reused while the fingerprint is unchanged; agent reads always hit test afresh.
  NSMapTable<UIView *, NSNumber *> *_hits;
  uint64_t _hitsFingerprint;
  NSMapTable<UIView *, NSNumber *> *_walkHits;
  BOOL _touching;
}

RCT_EXPORT_MODULE(InputInjector)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

- (NSArray<UIWindow *> *)visibleWindows
{
  NSMutableArray<UIWindow *> *windows = [NSMutableArray array];
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    BOOL foreground = scene.activationState == UISceneActivationStateForegroundActive || scene.activationState == UISceneActivationStateForegroundInactive;
    if (!foreground || ![scene isKindOfClass:UIWindowScene.class]) {
      continue;
    }
    for (UIWindow *window in ((UIWindowScene *)scene).windows) {
      if (!window.hidden && window.alpha > 0.01) {
        [windows addObject:window];
      }
    }
  }
  [windows sortUsingComparator:^NSComparisonResult(UIWindow *a, UIWindow *b) {
    if (a.windowLevel == b.windowLevel) {
      return a.isKeyWindow ? NSOrderedDescending : (b.isKeyWindow ? NSOrderedAscending : NSOrderedSame);
    }
    return a.windowLevel < b.windowLevel ? NSOrderedAscending : NSOrderedDescending;
  }];
  return windows;
}

// Topmost window that would receive a touch at this point, and the view it lands on.
- (UIWindow *)windowForPoint:(CGPoint)point hitView:(UIView **)hitView
{
  for (UIWindow *window in [(_walkWindows ?: [self visibleWindows]) reverseObjectEnumerator]) {
    if (!window.userInteractionEnabled) {
      continue;
    }
    UIView *view = [window hitTest:point withEvent:nil];
    if (view) {
      *hitView = view;
      return window;
    }
  }
  return nil;
}

- (UITouch *)touchAtPoint:(CGPoint)point inWindow:(UIWindow *)window view:(UIView *)view
{
  UITouch *touch = [[UITouch alloc] init];
  ((void (*)(id, SEL, id))objc_msgSend)(touch, @selector(setWindow:), window);
  ((void (*)(id, SEL, id))objc_msgSend)(touch, @selector(setView:), view);
  ((void (*)(id, SEL, NSUInteger))objc_msgSend)(touch, @selector(setTapCount:), 1);
  ((void (*)(id, SEL, CGPoint, BOOL))objc_msgSend)(touch, @selector(_setLocationInWindow:resetPrevious:), point, YES);
  ((void (*)(id, SEL, BOOL))objc_msgSend)(touch, @selector(_setIsFirstTouchForView:), YES);
  [self setPhase:UITouchPhaseBegan ofTouch:touch];
  return touch;
}

- (void)setPhase:(UITouchPhase)phase ofTouch:(UITouch *)touch
{
  ((void (*)(id, SEL, NSInteger))objc_msgSend)(touch, @selector(setPhase:), phase);
  ((void (*)(id, SEL, double))objc_msgSend)(touch, @selector(setTimestamp:), NSProcessInfo.processInfo.systemUptime);
}

- (void)moveTouch:(UITouch *)touch toPoint:(CGPoint)point
{
  ((void (*)(id, SEL, CGPoint, BOOL))objc_msgSend)(touch, @selector(_setLocationInWindow:resetPrevious:), point, NO);
  [self setPhase:UITouchPhaseMoved ofTouch:touch];
}

- (void)sendTouch:(UITouch *)touch
{
  UIApplication *app = UIApplication.sharedApplication;
  UIEvent *event = ((UIEvent * (*)(id, SEL))objc_msgSend)(app, NSSelectorFromString(@"_touchesEvent"));
  ((void (*)(id, SEL))objc_msgSend)(event, NSSelectorFromString(@"_clearTouches"));
  ((void (*)(id, SEL, id, BOOL))objc_msgSend)(event, NSSelectorFromString(@"_addTouch:forDelayedDelivery:"), touch, NO);
  [app sendEvent:event];
}

- (void)dragFrom:(CGPoint)from
              to:(CGPoint)to
           steps:(NSUInteger)steps
            hold:(NSTimeInterval)hold
        resolver:(RCTPromiseResolveBlock)resolve
        rejecter:(RCTPromiseRejectBlock)reject
{
  if (_touching) {
    reject(@"ERR_BUSY", @"Another touch is still in progress", nil);
    return;
  }
  UIView *hitView = nil;
  UIWindow *window = [self windowForPoint:from hitView:&hitView];
  if (!window) {
    reject(@"ERR_NO_WINDOW", [NSString stringWithFormat:@"No window takes touches at (%.0f, %.0f)", from.x, from.y], nil);
    return;
  }

  UITouch *touch;
  @try {
    touch = [self touchAtPoint:from inWindow:window view:hitView];
    [self sendTouch:touch];
  } @catch (NSException *exception) {
    reject(@"ERR_TOUCH", exception.reason, nil);
    return;
  }
  _touching = YES;

  __block NSUInteger step = 0;
  __block void (^next)(void);
  next = ^{
    @try {
      if (step < steps) {
        step += 1;
        CGFloat progress = (CGFloat)step / steps;
        CGPoint point = CGPointMake(from.x + (to.x - from.x) * progress, from.y + (to.y - from.y) * progress);
        [self moveTouch:touch toPoint:point];
        [self sendTouch:touch];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kMoveStepSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), next);
        return;
      }
      [self setPhase:UITouchPhaseEnded ofTouch:touch];
      [self sendTouch:touch];
      next = nil;
      self->_touching = NO;
      resolve(nil);
    } @catch (NSException *exception) {
      next = nil;
      self->_touching = NO;
      reject(@"ERR_TOUCH", exception.reason, nil);
    }
  };
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(hold * NSEC_PER_SEC)), dispatch_get_main_queue(), next);
}

RCT_EXPORT_METHOD(tap
                  : (double)x y
                  : (double)y resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  CGPoint point = CGPointMake(x, y);
  [self dragFrom:point to:point steps:0 hold:kTapHoldSeconds resolver:resolve rejecter:reject];
}

RCT_EXPORT_METHOD(swipe
                  : (double)fromX fromY
                  : (double)fromY toX
                  : (double)toX toY
                  : (double)toY durationMs
                  : (double)durationMs resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  NSUInteger steps = MAX(2, (NSUInteger)ceil(durationMs / 1000.0 / kMoveStepSeconds));
  [self dragFrom:CGPointMake(fromX, fromY) to:CGPointMake(toX, toY) steps:steps hold:kMoveStepSeconds resolver:resolve rejecter:reject];
}

static NSArray<NSString *> *TraitNames(UIAccessibilityTraits traits)
{
  NSMutableArray<NSString *> *names = [NSMutableArray array];
  if (traits & UIAccessibilityTraitButton) [names addObject:@"button"];
  if (traits & UIAccessibilityTraitLink) [names addObject:@"link"];
  if (traits & UIAccessibilityTraitHeader) [names addObject:@"header"];
  if (traits & UIAccessibilityTraitSelected) [names addObject:@"selected"];
  if (traits & UIAccessibilityTraitNotEnabled) [names addObject:@"disabled"];
  if (traits & UIAccessibilityTraitStaticText) [names addObject:@"text"];
  if (traits & UIAccessibilityTraitImage) [names addObject:@"image"];
  if (traits & UIAccessibilityTraitAdjustable) [names addObject:@"adjustable"];
  if (traits & UIAccessibilityTraitSearchField) [names addObject:@"search"];
  if (traits & UIAccessibilityTraitTabBar) [names addObject:@"tabbar"];
  return names;
}

// The app's pressables are gesture-handler views rather than accessibility elements.
static BOOL HasTapRecognizer(UIView *view)
{
  static Class tapClass;
  static Class longPressClass;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    tapClass = NSClassFromString(@"RNBetterTapGestureRecognizer");
    longPressClass = NSClassFromString(@"RNBetterLongPressGestureRecognizer");
  });
  for (UIGestureRecognizer *recognizer in view.gestureRecognizers) {
    if (recognizer.enabled && ((tapClass && [recognizer isKindOfClass:tapClass]) || (longPressClass && [recognizer isKindOfClass:longPressClass]))) {
      return YES;
    }
  }
  return NO;
}

// RN text views' attributedText for the current snapshot; RCTParagraphComponentView rebuilds it on every read.
static NSMapTable<UIView *, NSAttributedString *> *sWalkTexts;

static Class ParagraphClass(void)
{
  static Class paragraph;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    paragraph = NSClassFromString(@"RCTParagraphComponentView");
  });
  return paragraph;
}

static NSAttributedString *AttributedTextOf(UIView *view)
{
  BOOL paragraph = ParagraphClass() && [view isKindOfClass:ParagraphClass()];
  NSAttributedString *text = paragraph ? [sWalkTexts objectForKey:view] : nil;
  if (text || ![view respondsToSelector:@selector(attributedText)]) return text;
  id value = ((id (*)(id, SEL))objc_msgSend)(view, @selector(attributedText));
  text = [value isKindOfClass:NSAttributedString.class] ? value : [NSAttributedString new];
  if (paragraph) [sWalkTexts setObject:text forKey:view];
  return text;
}

// For RN text, calls RCTViewComponentView's accessibilityLabel directly to skip the paragraph's override, which rebuilds its text.
static NSString *LabelOf(UIView *view)
{
  if (!sWalkTexts || !ParagraphClass() || ![view isKindOfClass:ParagraphClass()]) return view.accessibilityLabel;
  static NSString *(*viewLabel)(id, SEL);
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    viewLabel = (NSString * (*)(id, SEL)) class_getMethodImplementation(class_getSuperclass(ParagraphClass()), @selector(accessibilityLabel));
  });
  NSString *label = viewLabel(view, @selector(accessibilityLabel));
  return label.length > 0 ? label : AttributedTextOf(view).string;
}

static void AppendLabels(NSArray<NSString *> *labels, NSMutableArray<NSString *> *into, NSUInteger *length)
{
  for (NSString *label in labels) {
    if (*length > kMaxGatheredText) return;
    if (![into containsObject:label]) {
      [into addObject:label];
      *length += label.length;
    }
  }
}

static void CollectLabels(UIView *view, NSMutableArray<NSString *> *into, NSUInteger *length)
{
  if (*length > kMaxGatheredText || view.hidden || view.alpha < 0.01) return;
  NSString *label = LabelOf(view);
  if (label.length > 0) {
    AppendLabels(@[ label ], into, length);
    return;
  }
  for (UIView *subview in view.subviews) {
    CollectLabels(subview, into, length);
  }
}

static NSArray<NSString *> *LabelsIn(UIView *view)
{
  NSMutableArray<NSString *> *labels = [NSMutableArray array];
  NSUInteger length = 0;
  CollectLabels(view, labels, &length);
  return labels;
}

static inline void Mix(uint64_t *hash, uint64_t value)
{
  *hash ^= value + 0x9e3779b97f4a7c15ULL + (*hash << 6) + (*hash >> 2);
}

static inline uint64_t Bits(CGFloat value)
{
  double number = value;
  uint64_t bits;
  memcpy(&bits, &number, sizeof bits);
  return bits;
}

// Cheap enough to poll: covers frames, scrolling, alpha, transforms and field text, but not text React re-renders.
static void Fingerprint(UIView *view, uint64_t *hash)
{
  if (view.hidden || view.alpha < 0.01) return;
  CALayer *layer = view.layer;
  Mix(hash, (uint64_t)(uintptr_t)(__bridge void *)view);
  Mix(hash, Bits(layer.position.x));
  Mix(hash, Bits(layer.position.y));
  Mix(hash, Bits(layer.bounds.origin.x));
  Mix(hash, Bits(layer.bounds.origin.y));
  Mix(hash, Bits(layer.bounds.size.width));
  Mix(hash, Bits(layer.bounds.size.height));
  Mix(hash, Bits(view.alpha));
  Mix(hash, view.userInteractionEnabled);
  if (!CATransform3DIsIdentity(layer.transform)) {
    CATransform3D transform = layer.transform;
    Mix(hash, Bits(transform.m11));
    Mix(hash, Bits(transform.m12));
    Mix(hash, Bits(transform.m21));
    Mix(hash, Bits(transform.m22));
    Mix(hash, Bits(transform.m41));
    Mix(hash, Bits(transform.m42));
  }
  if ([view isKindOfClass:UITextField.class]) {
    Mix(hash, ((UITextField *)view).text.hash);
    return;
  }
  if ([view isKindOfClass:UITextView.class]) {
    Mix(hash, ((UITextView *)view).text.hash);
    return;
  }
  for (UIView *subview in view.subviews) {
    Fingerprint(subview, hash);
  }
  Mix(hash, 0);
}

static NSDictionary *RectDict(CGRect rect)
{
  return @{
    @"x" : @(round(rect.origin.x * 2) / 2),
    @"y" : @(round(rect.origin.y * 2) / 2),
    @"width" : @(round(rect.size.width * 2) / 2),
    @"height" : @(round(rect.size.height * 2) / 2),
  };
}

static int ColorByte(CGFloat value)
{
  return (int)round(MAX(0, MIN(1, value)) * 255);
}

// #RRGGBBAA, with `opacity` from the views around it; nil for no color or a clear one.
static NSString *HexColor(UIColor *color, UITraitCollection *traits, CGFloat opacity)
{
  CGFloat r = 0, g = 0, b = 0, a = 0;
  if (!color || ![[color resolvedColorWithTraitCollection:traits] getRed:&r green:&g blue:&b alpha:&a] || a * opacity < 0.01) {
    return nil;
  }
  return [NSString stringWithFormat:@"#%02X%02X%02X%02X", ColorByte(r), ColorByte(g), ColorByte(b), ColorByte(a * opacity)];
}

// CSS font weight: the font's weight trait when it has one, else what its name says.
static NSInteger CSSWeight(UIFont *font)
{
  NSNumber *trait = font.fontDescriptor.fontAttributes[UIFontDescriptorTraitsAttribute][UIFontWeightTrait];
  if (trait) {
    CGFloat weight = trait.doubleValue;
    CGFloat limits[] = {UIFontWeightUltraLight, UIFontWeightThin, UIFontWeightLight, UIFontWeightRegular, UIFontWeightMedium, UIFontWeightSemibold, UIFontWeightBold, UIFontWeightHeavy};
    NSInteger count = sizeof(limits) / sizeof(limits[0]);
    for (NSInteger i = 0; i < count; i++) {
      if (weight < limits[i] + 0.05) return (i + 1) * 100;
    }
    return 900;
  }
  NSString *name = font.fontName.lowercaseString;
  NSArray<NSArray *> *names = @[ @[ @"black", @900 ], @[ @"heavy", @800 ], @[ @"extrabold", @800 ], @[ @"semibold", @600 ], @[ @"demibold", @600 ], @[ @"bold", @700 ], @[ @"medium", @500 ], @[ @"light", @300 ], @[ @"thin", @200 ] ];
  for (NSArray *entry in names) {
    if ([name containsString:entry[0]]) return [entry[1] integerValue];
  }
  return (font.fontDescriptor.symbolicTraits & UIFontDescriptorTraitBold) ? 700 : 400;
}

static NSDictionary *TextStyleDict(UIFont *font, UIColor *color, NSTextAlignment alignment, UITraitCollection *traits, CGFloat opacity)
{
  NSMutableDictionary *style = [NSMutableDictionary dictionary];
  if (font) {
    style[@"size"] = @(round(font.pointSize * 2) / 2);
    style[@"weight"] = @(CSSWeight(font));
    if (font.fontDescriptor.symbolicTraits & UIFontDescriptorTraitItalic) style[@"italic"] = @YES;
  }
  NSString *hex = HexColor(color, traits, opacity);
  if (hex) style[@"color"] = hex;
  if (alignment == NSTextAlignmentCenter) style[@"align"] = @"center";
  if (alignment == NSTextAlignmentRight) style[@"align"] = @"right";
  if (alignment == NSTextAlignmentJustified) style[@"align"] = @"justify";
  return style;
}

// A text view's or field's text and how its first character is drawn, into `box`.
static void AddTextAndStyle(UIView *view, NSMutableDictionary *box, CGFloat opacity)
{
  NSAttributedString *text = AttributedTextOf(view);
  BOOL field = [view isKindOfClass:UITextField.class] || [view isKindOfClass:UITextView.class];
  if (text.length > 0) {
    NSDictionary *attributes = [text attributesAtIndex:0 effectiveRange:NULL];
    UIFont *font = attributes[NSFontAttributeName] ?: (field ? ((UITextField *)view).font : nil);
    UIColor *color = attributes[NSForegroundColorAttributeName] ?: (field ? ((UITextField *)view).textColor : nil);
    NSParagraphStyle *paragraph = attributes[NSParagraphStyleAttributeName];
    NSTextAlignment alignment = paragraph ? paragraph.alignment : (field ? [(UITextField *)view textAlignment] : NSTextAlignmentNatural);
    NSString *string = text.string;
    if (string.length > kMaxViewText) {
      string = [string substringToIndex:[string rangeOfComposedCharacterSequenceAtIndex:kMaxViewText].location];
    }
    box[@"text"] = string;
    box[@"style"] = TextStyleDict(font, color, alignment, view.traitCollection, opacity);
    return;
  }
  if (!field || ![view respondsToSelector:@selector(placeholder)]) return;
  id placeholder = ((id (*)(id, SEL))objc_msgSend)(view, @selector(placeholder));
  if (![placeholder isKindOfClass:NSString.class] || [placeholder length] == 0) return;
  UIColor *color = UIColor.placeholderTextColor;
  if ([view isKindOfClass:UITextField.class] && ((UITextField *)view).attributedPlaceholder.length > 0) {
    color = [((UITextField *)view).attributedPlaceholder attribute:NSForegroundColorAttributeName atIndex:0 effectiveRange:NULL] ?: color;
  }
  box[@"text"] = placeholder;
  box[@"placeholder"] = @YES;
  box[@"style"] = TextStyleDict(((UITextField *)view).font, color, [(UITextField *)view textAlignment], view.traitCollection, opacity);
}

// The wireframe box for a view: its visible frame and whatever it draws itself.
static NSMutableDictionary *ViewBox(UIView *view, CGRect frame, CGRect visible, NSUInteger windowIndex, CGFloat opacity)
{
  NSMutableDictionary *box = [NSMutableDictionary dictionary];
  UITraitCollection *traits = view.traitCollection;
  UIColor *background = view.backgroundColor ?: (view.layer.backgroundColor ? [UIColor colorWithCGColor:view.layer.backgroundColor] : nil);
  NSString *backgroundHex = HexColor(background, traits, opacity);
  if (backgroundHex) box[@"background"] = backgroundHex;
  NSString *borderHex = view.layer.borderWidth > 0 && view.layer.borderColor ? HexColor([UIColor colorWithCGColor:view.layer.borderColor], traits, opacity) : nil;
  if (borderHex) box[@"border"] = @{@"color" : borderHex, @"width" : @(view.layer.borderWidth)};
  if (view.layer.cornerRadius > 0) box[@"radius"] = @(round(view.layer.cornerRadius * 2) / 2);
  AddTextAndStyle(view, box, opacity);
  box[@"frame"] = RectDict(visible);
  if (!CGRectEqualToRect(CGRectIntegral(frame), CGRectIntegral(visible))) box[@"full"] = RectDict(frame);
  box[@"window"] = @(windowIndex);
  return box;
}

// Moves a field's text into a box on the line it's drawn on; nil when there's no text or the line is off screen.
static NSMutableDictionary *SplitFieldText(UITextField *field, NSMutableDictionary *box, UIWindow *window, CGRect clip)
{
  if (!box[@"text"]) return nil;
  CGRect textRect = [field textRectForBounds:field.bounds];
  CGFloat lineHeight = field.font ? MIN(field.font.lineHeight, textRect.size.height) : textRect.size.height;
  CGRect line = CGRectMake(textRect.origin.x, CGRectGetMidY(textRect) - lineHeight / 2, textRect.size.width, lineHeight);
  CGRect frame = [field convertRect:line toView:window];
  CGRect visible = CGRectIntersection(frame, clip);
  if (CGRectIsNull(visible) || CGRectIsEmpty(visible)) return nil;
  NSMutableDictionary *text = [NSMutableDictionary dictionary];
  for (NSString *key in @[ @"text", @"placeholder", @"style", @"window" ]) {
    if (box[key]) text[key] = box[key];
  }
  text[@"frame"] = RectDict(visible);
  if (!CGRectEqualToRect(CGRectIntegral(frame), CGRectIntegral(visible))) text[@"full"] = RectDict(frame);
  [box removeObjectsForKeys:@[ @"text", @"placeholder", @"style" ]];
  return text;
}

// With needsText, returns the labels inside the view, for a pressable that has none of its own.
- (NSArray<NSString *> *)collectFromView:(UIView *)view
                                  window:(UIWindow *)window
                             windowIndex:(NSUInteger)windowIndex
                                    clip:(CGRect)clip
                                 opacity:(CGFloat)opacity
                           parentVisible:(CGRect)parentVisible
                               needsText:(BOOL)needsText
                                elements:(NSMutableArray *)elements
                                   views:(NSMutableArray *)views
{
  if (view.hidden || view.alpha < 0.01) {
    return nil;
  }
  BOOL elementsFull = elements.count >= kMaxElements;
  BOOL viewsFull = !views || views.count >= kMaxViews;
  if (elementsFull && viewsFull) {
    return needsText ? LabelsIn(view) : nil;
  }
  opacity *= view.alpha;
  CGRect frame = [view convertRect:view.bounds toView:window];
  CGRect visible = CGRectIntersection(frame, clip);
  BOOL onScreen = !CGRectIsNull(visible) && !CGRectIsEmpty(visible);
  if (view.clipsToBounds) {
    if (!onScreen) {
      return needsText ? LabelsIn(view) : nil;
    }
    clip = visible;
  }

  if (!viewsFull && onScreen) {
    NSMutableDictionary *box = ViewBox(view, frame, visible, windowIndex, opacity);
    BOOL draws = box[@"background"] || box[@"border"] || box[@"text"];
    NSMutableDictionary *text = [view isKindOfClass:UITextField.class] ? SplitFieldText((UITextField *)view, box, window, clip) : nil;
    if (draws || !CGRectEqualToRect(CGRectIntegral(visible), CGRectIntegral(parentVisible))) {
      [views addObject:box];
    }
    if (text) [views addObject:text];
  }
  if (onScreen) {
    parentVisible = visible;
  }
  // The editor and placeholder label UIKit puts inside a field would draw its text again.
  if ([view isKindOfClass:UITextField.class] || [view isKindOfClass:UITextView.class]) {
    views = nil;
  }
  // RN text has its text as a label but isn't an accessibility element unless VoiceOver is running.
  NSString *label = !elementsFull || needsText ? LabelOf(view) : nil;
  BOOL tappable = !elementsFull && HasTapRecognizer(view);
  BOOL gathers = label.length == 0 && (needsText || tappable);
  NSMutableDictionary *element = nil;
  NSString *testID = elementsFull ? nil : view.accessibilityIdentifier;
  BOOL listed = !elementsFull && (testID.length > 0 || label.length > 0 || view.isAccessibilityElement || tappable);
  if (listed && onScreen) {
    CGPoint center = CGPointMake(CGRectGetMidX(visible), CGRectGetMidY(visible));
    NSNumber *known = [_walkHits objectForKey:view];
    BOOL hittable = known.boolValue;
    if (!known) {
      UIView *hit = nil;
      UIWindow *hitWindow = [self windowForPoint:center hitView:&hit];
      hittable = hitWindow == window && hit != nil && (hit == view || [hit isDescendantOfView:view]);
      [_walkHits setObject:@(hittable) forKey:view];
    }
    element = [@{
      @"frame" : RectDict(frame),
      @"center" : @{@"x" : @(round(center.x)), @"y" : @(round(center.y))},
      @"traits" : TraitNames(view.accessibilityTraits | (tappable ? UIAccessibilityTraitButton : 0)),
      @"hittable" : @(hittable),
      @"window" : @(windowIndex),
      @"type" : NSStringFromClass(view.class),
    } mutableCopy];
    if (testID.length > 0) element[@"testID"] = testID;
    if (label.length > 0) element[@"label"] = label;
    NSString *value = [view isKindOfClass:UITextField.class] ? ((UITextField *)view).text
                      : [view isKindOfClass:UITextView.class] ? ((UITextView *)view).text
                                                               : view.accessibilityValue;
    if (value.length > 0) element[@"value"] = value;
    [elements addObject:element];
  }

  NSMutableArray<NSString *> *texts = gathers ? [NSMutableArray array] : nil;
  NSUInteger length = 0;
  for (UIView *subview in view.subviews) {
    NSArray<NSString *> *inner = [self collectFromView:subview
                                                window:window
                                           windowIndex:windowIndex
                                                  clip:clip
                                               opacity:opacity
                                         parentVisible:parentVisible
                                             needsText:gathers && length <= kMaxGatheredText
                                              elements:elements
                                                 views:views];
    if (texts) AppendLabels(inner, texts, &length);
  }
  if (element && tappable && label.length == 0 && texts.count > 0) {
    element[@"label"] = [texts componentsJoinedByString:@", "];
  }
  if (!needsText) return nil;
  return label.length > 0 ? @[ label ] : texts;
}

- (uint64_t)fingerprintOfWindows:(NSArray<UIWindow *> *)windows
{
  uint64_t hash = windows.count;
  for (UIWindow *window in windows) {
    Fingerprint(window, &hash);
  }
  return hash;
}

- (NSDictionary *)snapshotWithViews:(BOOL)withViews
{
  NSMutableArray *elements = [NSMutableArray array];
  NSMutableArray *views = withViews ? [NSMutableArray array] : nil;
  NSArray<UIWindow *> *windows = [self visibleWindows];
  if (withViews) {
    uint64_t fingerprint = [self fingerprintOfWindows:windows];
    if (!_hits || fingerprint != _hitsFingerprint) {
      _hits = [NSMapTable weakToStrongObjectsMapTable];
      _hitsFingerprint = fingerprint;
    }
  }
  _walkWindows = windows;
  _walkHits = withViews ? _hits : nil;
  sWalkTexts = [NSMapTable strongToStrongObjectsMapTable];
  @try {
    [windows enumerateObjectsUsingBlock:^(UIWindow *window, NSUInteger index, BOOL *stop) {
      [self collectFromView:window
                     window:window
                windowIndex:index
                       clip:window.bounds
                    opacity:1
              parentVisible:CGRectNull
                  needsText:NO
                   elements:elements
                      views:views];
    }];
  } @finally {
    _walkWindows = nil;
    _walkHits = nil;
    sWalkTexts = nil;
  }
  UIWindow *top = windows.lastObject;
  NSMutableDictionary *snapshot = [@{
    @"elements" : elements,
    @"truncated" : @(elements.count >= kMaxElements),
    @"screen" : top ? RectDict(top.bounds) : RectDict(UIScreen.mainScreen.bounds),
  } mutableCopy];
  if (views) {
    snapshot[@"views"] = views;
    snapshot[@"viewsTruncated"] = @(views.count >= kMaxViews);
  }
  return snapshot;
}

RCT_EXPORT_METHOD(elements : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
{
  @try {
    resolve([self snapshotWithViews:NO]);
  } @catch (NSException *exception) {
    reject(@"ERR_ELEMENTS", exception.reason, nil);
  }
}

// The elements, and every view as drawn for the Input panel's wireframe.
RCT_EXPORT_METHOD(elementsAndViews : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
{
  @try {
    resolve([self snapshotWithViews:YES]);
  } @catch (NSException *exception) {
    reject(@"ERR_ELEMENTS", exception.reason, nil);
  }
}

// A hash of the views on screen, for telling whether the screen changed without reading it.
RCT_EXPORT_METHOD(fingerprint : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
{
  resolve([NSString stringWithFormat:@"%016llx", [self fingerprintOfWindows:[self visibleWindows]]]);
}

- (UIView *)firstResponderIn:(UIView *)view
{
  if (view.isFirstResponder) {
    return view;
  }
  for (UIView *subview in view.subviews) {
    UIView *found = [self firstResponderIn:subview];
    if (found) {
      return found;
    }
  }
  return nil;
}

// The focused view that takes text, or nil after rejecting with why there isn't one.
- (UIView<UIKeyInput> *)focusedTextInput:(RCTPromiseRejectBlock)reject
{
  for (UIWindow *window in [[self visibleWindows] reverseObjectEnumerator]) {
    UIView *responder = [self firstResponderIn:window];
    if (!responder) {
      continue;
    }
    if (![responder conformsToProtocol:@protocol(UIKeyInput)]) {
      reject(@"ERR_NOT_TEXT", [NSString stringWithFormat:@"Focused view %@ does not take text", NSStringFromClass(responder.class)], nil);
      return nil;
    }
    return (UIView<UIKeyInput> *)responder;
  }
  reject(@"ERR_NO_FOCUS", @"No text field is focused; tap one first", nil);
  return nil;
}

// "\n" is the return key: a single-line field submits, as it does for the keyboard's.
RCT_EXPORT_METHOD(typeText
                  : (NSString *)text resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  UIView<UIKeyInput> *input = [self focusedTextInput:reject];
  if (!input) {
    return;
  }
  [input insertText:text];
  resolve(@{@"view" : NSStringFromClass(input.class)});
}

// The keyboard's delete key, `count` times: a selection goes first, then the character before the cursor.
RCT_EXPORT_METHOD(deleteBackward
                  : (double)count resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  UIView<UIKeyInput> *input = [self focusedTextInput:reject];
  if (!input) {
    return;
  }
  for (NSInteger i = 0; i < MAX(1, (NSInteger)count); i++) {
    [input deleteBackward];
  }
  resolve(@{@"view" : NSStringFromClass(input.class)});
}

@end

#endif
