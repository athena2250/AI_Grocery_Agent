"""Seed recipe DB (plan_11): common household dishes → catalog `product_id`s.

Ingredients use only products in the seed catalog (mobile/src/data/seed.ts);
anything the catalog lacks (tamarind, cauliflower, ...) is left out rather
than invented. Aliases are what Mom might call the dish.
"""

from __future__ import annotations

from .rules import Recipe


def _r(id: str, name: str, aliases: tuple[str, ...], *ingredients: str) -> Recipe:
    return Recipe(id=id, name=name, aliases=(name.lower(), *aliases), ingredients=ingredients)


_TADKA = ("p_mustard_seeds", "p_cumin", "p_curry_leaves")

RECIPES: tuple[Recipe, ...] = (
    _r("r_sambar", "Sambar", (), "p_toor_dal", "p_tomato", "p_onion", "p_turmeric",
       "p_chilli_powder", "p_coriander_powder", *_TADKA, "p_coriander_leaves", "p_salt"),
    _r("r_rasam", "Rasam", ("saaru",), "p_tomato", "p_toor_dal", "p_garlic", "p_cumin",
       "p_turmeric", "p_curry_leaves", "p_coriander_leaves", "p_salt"),
    _r("r_dal_tadka", "Dal tadka", ("dal fry", "dal"), "p_toor_dal", "p_onion", "p_tomato",
       "p_garlic", "p_cumin", "p_turmeric", "p_chilli_powder", "p_ghee", "p_salt"),
    _r("r_moong_dal", "Moong dal", ("yellow dal",), "p_moong_dal", "p_tomato", "p_cumin",
       "p_turmeric", "p_ghee", "p_salt"),
    _r("r_chana_dal", "Chana dal", (), "p_chana_dal", "p_onion", "p_tomato", "p_ginger",
       "p_turmeric", "p_garam_masala", "p_salt"),
    _r("r_palak_dal", "Palak dal", ("spinach dal", "keerai kootu"), "p_toor_dal", "p_spinach",
       "p_garlic", "p_cumin", "p_turmeric", "p_salt"),
    _r("r_rajma", "Rajma", ("rajma chawal",), "p_rajma", "p_onion", "p_tomato", "p_ginger",
       "p_garlic", "p_garam_masala", "p_chilli_powder", "p_rice", "p_salt"),
    _r("r_khichdi", "Khichdi", ("pongal",), "p_rice", "p_moong_dal", "p_cumin", "p_turmeric",
       "p_ghee", "p_ginger", "p_salt"),
    _r("r_jeera_rice", "Jeera rice", (), "p_rice", "p_cumin", "p_ghee", "p_salt"),
    _r("r_lemon_rice", "Lemon rice", ("chitranna",), "p_rice", "p_lemon", "p_chana_dal",
       "p_turmeric", "p_chilli", *_TADKA, "p_salt"),
    _r("r_curd_rice", "Curd rice", ("thayir sadam", "mosaru anna"), "p_rice", "p_curd",
       "p_mustard_seeds", "p_curry_leaves", "p_ginger", "p_chilli", "p_salt"),
    _r("r_tomato_rice", "Tomato rice", (), "p_rice", "p_tomato", "p_onion", "p_chilli",
       "p_garam_masala", "p_sunflower_oil", "p_salt"),
    _r("r_veg_pulao", "Veg pulao", ("pulao", "pulav"), "p_rice", "p_carrot", "p_potato",
       "p_onion", "p_garam_masala", "p_ghee", "p_salt"),
    _r("r_poha", "Poha", ("aval", "avalakki"), "p_poha", "p_onion", "p_potato", "p_chilli",
       "p_mustard_seeds", "p_curry_leaves", "p_turmeric", "p_lemon", "p_salt"),
    _r("r_upma", "Upma", ("uppittu",), "p_sooji", "p_onion", "p_chilli", "p_ginger",
       *_TADKA, "p_ghee", "p_salt"),
    _r("r_chapati", "Chapati", ("roti", "phulka"), "p_wheat_atta", "p_salt", "p_ghee"),
    _r("r_aloo_paratha", "Aloo paratha", (), "p_wheat_atta", "p_potato", "p_chilli",
       "p_coriander_leaves", "p_garam_masala", "p_butter", "p_salt"),
    _r("r_jeera_aloo", "Jeera aloo", ("aloo fry", "potato fry"), "p_potato", "p_cumin",
       "p_turmeric", "p_chilli_powder", "p_coriander_leaves", "p_salt"),
    _r("r_carrot_poriyal", "Carrot poriyal", ("carrot sabzi",), "p_carrot", "p_mustard_seeds",
       "p_curry_leaves", "p_chilli", "p_salt"),
    _r("r_palak_paneer", "Palak paneer", (), "p_spinach", "p_paneer", "p_onion", "p_tomato",
       "p_garlic", "p_ginger", "p_garam_masala", "p_salt"),
    _r("r_paneer_butter_masala", "Paneer butter masala", ("paneer masala",), "p_paneer",
       "p_tomato", "p_onion", "p_butter", "p_ginger", "p_garlic", "p_garam_masala",
       "p_chilli_powder", "p_salt"),
    _r("r_paneer_bhurji", "Paneer bhurji", (), "p_paneer", "p_onion", "p_tomato", "p_chilli",
       "p_turmeric", "p_coriander_leaves", "p_salt"),
    _r("r_raita", "Raita", ("pachadi",), "p_curd", "p_onion", "p_cumin", "p_coriander_leaves",
       "p_salt"),
    _r("r_buttermilk", "Buttermilk", ("chaas", "majjige", "neer mor"), "p_curd", "p_cumin",
       "p_curry_leaves", "p_ginger", "p_chilli", "p_salt"),
    _r("r_coriander_chutney", "Coriander chutney", ("green chutney", "hari chutney"),
       "p_coriander_leaves", "p_chilli", "p_lemon", "p_ginger", "p_salt"),
    _r("r_tomato_chutney", "Tomato chutney", (), "p_tomato", "p_onion", "p_chilli_powder",
       "p_garlic", "p_mustard_seeds", "p_salt"),
    _r("r_kheer", "Kheer", ("payasam", "rice kheer"), "p_rice", "p_milk", "p_sugar", "p_ghee"),
    _r("r_sooji_halwa", "Sooji halwa", ("kesari", "sheera", "rava kesari"), "p_sooji",
       "p_sugar", "p_ghee", "p_milk"),
    _r("r_gajar_halwa", "Gajar halwa", ("carrot halwa",), "p_carrot", "p_milk", "p_sugar",
       "p_ghee"),
    _r("r_masala_chai", "Masala chai", ("chai", "tea"), "p_tea", "p_milk", "p_sugar",
       "p_ginger"),
    _r("r_filter_coffee", "Filter coffee", ("coffee",), "p_coffee", "p_milk", "p_sugar"),
    _r("r_fruit_salad", "Fruit salad", (), "p_banana", "p_apple", "p_orange", "p_sugar"),
)  # fmt: skip
