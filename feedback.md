## gameplay moment problems:

- energy refills easily (3 en for attack). should be more difficult to get and energy
- brace ability - no shield bar displayed
- when attacking the hero need to get closer to enemy and by attacking touching him with weapon an so we fell that our attack have fait des degats aux monstres
- attack and action happens fast so we can blink the damage received, hp restored or anything else about it and cannot understand what enemy did
- timing for parry to decerease damage to 30% (hero lift the shield or covers with weapon). but should be perfect timing.
- dimonds can  be used instead of gold (you can use gold or diamonds) for any type of items but dimonds can be used for special items
- I had a problem I attacked and killed the enemy and i had not a lot of hp. so after my attack me and enemy had 0 HP bur we won. analyze these moments. possibly contr attack of enemy happens after his death. 
- would be great to have log of fight. how many damage who dealed to who, healed or used soome items, reflected or anything.



## design upgrades:
- add dynamic music
- more game balance please. currently it is easy.
- the set section has troubles - doesn't collapse and expand to display the items of set and bonuses from set
-stats section, set, items sections are not scrollable for now
- different effects of attacks and parrying for different sets (if i have for exemple a weapons of emberforged set the attack will have a fire like animation and if i have a shield of tidecaller at the sime time when i parry i will have a water like animation)
- add more different biomes
- remove the possibility to buy from wayside traider outside of trade line interaction (currently we have seller button on top right always accessible. no this button. we should have the seller when we choose him on the road.). and in the seller we need the inventory button to have possibility to sell something if we don't have enough money.
- add a beutiful main screen with the best artistic design in setting (styling) of our game. (so you not just start the gameplay when you opened app but have the main screen before it )
- in main screen we have the statistic how many enemies we killed, bosses etc. donate button, we need to have a button of settings where we can choose the language (localistation and translation to french and english), the audio volume
- when we choosed the line and after we moved to this line with side animation the charackter's animation looks like he is coninuing running to direction instead if running forward
- when my hero dies if i watched advertisement to cintinue, it is sill the hero dying animation in cycle
- if we cannot beat the current boss instead of returning to the road on the same step (when we meet the boss immediately and loose), it should be started from step 0 of this level instead to have possibility to get him 
- for enemies some knife and daggers are directed inward.  looks strange and unrealistic. like enemy is close to harm himself instead of pointing to us...
- filter in inventory add a new section with filtered objects instead if filtering current list. like this each we we click filter - on the bottom adds new inventory list. 



# Round 2 (2026-09-28)

Overall everything looks amazing and very interesting to play.

## bugs
- main menu shows "best run 0m" and it never changes, even after playing.
- when my bag was full I couldn't change my equipment.
- after buying bag slots (increase with gems) I got slots = NaN and gems = NaN. Because of that it was treated as 0 and I couldn't do anything about it.

## inventory & trader
- the normal bag is too small, it should be bigger.
- keep increasing the bag at the trader, but with a limit of increases per trader, and a much bigger limit for the total (I increased it many times, reached the max and still wanted more space).
- in the sell section add "sell by rarity" next to "sell all".

## ads & monetisation
- no limits for getting gems by watching ads, no limits for doubling a reward by ad — it's okay.
- revive by watching an ad: 3 revives per fight.
- hide gem packs and support tiers for now (don't remove them, we will very possibly return them one day).
- prepare the real advertisements for the Android build (AdMob), except in debug mode when launched locally.
