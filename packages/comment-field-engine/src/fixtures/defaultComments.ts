import { parsePlainText } from "../import/parseComments";

export const DEFAULT_COMMENT_TEXT = `@PizzaFan88 | We need chunky sausage back
@SauceBoss | This was the best topping
@CrustCritic | Ordering somewhere else
@SliceSeeker | Please tell me this is temporary
@PizzaLover | BRING IT BACK
@PapaMurphys | Chunky's Back. You're Welcome.
@ToppingTracker | I still think about that sausage
@DoughSide | Justice for the chunky topping
@FamilySlice | Our Friday order hasn't been the same
@CheesePlease | Put it back on the menu
@OvenFresh | The people have spoken
@TakeNBakeFan | This is the comeback we needed
@CrustClub | Say less. Ordering tonight.
@SaucyTake | Best news in my feed today
@DinnerPlanner | Friday night is officially handled
@ExtraCheese | I knew you'd listen
@SliceReport | Huge day for pizza fans
@ToppingTruth | Never should have left
@BakeAtHome | My freezer is ready
@PepperoniPal | Adding this to the family order
@PizzaNight | We are so back
@CraveWave | Been waiting for this notification
@MenuWatcher | Finally finally finally
@HotSlice | This made my whole week
@DoughGood | An all-time topping returns
@FamilyFavorite | The kids are going to lose it
@DinnerHero | Tonight's plan just changed
@CrustFirst | Welcome back, old friend
@SauceSignal | Sending this to everyone
@ToppingNews | Chunky's comeback season`;

export const DEFAULT_COMMENTS = parsePlainText(DEFAULT_COMMENT_TEXT).records;
