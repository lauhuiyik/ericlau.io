/* ============ Japan 2026 itinerary app ============ */
(function(){
  "use strict";

  var SPOTS = (typeof SPOTS_CLEAN !== "undefined") ? SPOTS_CLEAN : SPOTS;
  var spotById = {};
  SPOTS.forEach(function(s){ spotById[s.id] = s; });
  var SHOPLIST = (typeof SHOPS !== "undefined") ? SHOPS : [];
  var shopById = {}; SHOPLIST.forEach(function(s){ shopById[s.id]=s; });


  /* ---------- helpers ---------- */
  function ready(fn){ if(document.readyState!=="loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  function el(tag, cls, html){ var e=document.createElement(tag); if(cls) e.className=cls; if(html!=null) e.innerHTML=html; return e; }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c];}); }
  function mapsUrl(q){ return "https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(q); }
  function photosUrl(q){ return "https://www.google.com/search?tbm=isch&q="+encodeURIComponent(q); }
  function photoQuery(spot){ return spot.maps || (spot.name+" "+(spot.area||"")+" "+(spot.city||"")); }

  function haversine(a,b,c,d){ // km
    var R=6371, dl=(c-a)*Math.PI/180, dn=(d-b)*Math.PI/180;
    var x=Math.sin(dl/2)*Math.sin(dl/2)+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dn/2)*Math.sin(dn/2);
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  }
  function nearestHotel(spot){
    var best=null, bd=1e9;
    HOTELS.forEach(function(h){
      if(h.city && spot.city && h.city!==spot.city) return;
      var d=haversine(spot.lat,spot.lng,h.lat,h.lng);
      if(d<bd){ bd=d; best=h; }
    });
    if(!best){ HOTELS.forEach(function(h){ var d=haversine(spot.lat,spot.lng,h.lat,h.lng); if(d<bd){bd=d;best=h;} }); }
    return { hotel:best, km:bd };
  }
  function distLabel(spot){
    var n=nearestHotel(spot); if(!n.hotel) return "";
    var km=n.km, walk=Math.round(km*1000/80); // ~80 m/min
    var kmTxt=km<1?Math.round(km*1000)+" m":km.toFixed(1)+" km";
    var short=n.hotel.name.replace(/^(Hotel |THE |Keisei Richmond Hotel )/i,"").split(",")[0];
    var w = walk<=35 ? " · ~"+walk+" min walk" : "";
    return "📍 "+kmTxt+w+" from "+esc(short);
  }

  /* ---------- checkbox state ---------- */
  var KEY="japan26_checked", checked={};
  try{ checked=JSON.parse(localStorage.getItem(KEY)||"{}")||{}; }catch(e){ checked={}; }
  function save(){ try{ localStorage.setItem(KEY,JSON.stringify(checked)); }catch(e){} }
  function isChecked(id){ return !!checked[id]; }
  function setChecked(id,v){ if(v) checked[id]=1; else delete checked[id]; save(); updateProgress(); }
  function updateProgress(){
    var total=SPOTS.filter(function(s){return s.meal!=="attraction";}).length;
    var done=Object.keys(checked).filter(function(k){return spotById[k] && spotById[k].meal!=="attraction";}).length;
    var p=document.getElementById("progress");
    if(p) p.innerHTML="Ticked off: <b>"+done+"</b> / "+total;
  }

  /* ---------- filters ---------- */
  var state={ view:"hotel", meal:"all", q:"", hideChecked:false, megan:false };
  try{ var sv=localStorage.getItem("japan26_view"); if(sv) state.view=sv; }catch(e){}
  try{ state.megan = localStorage.getItem("japan26_megan")==="1"; }catch(e){}
  if(state.view==="area"||state.view==="map") state.view="hotel"; // migrate old views
  if(["hotel","day","near"].indexOf(state.view)===-1) state.view="hotel";
  var userPos=null, geoStatus=""; // current location

  function matches(spot){
    if(state.meal!=="all"){
      if(state.meal==="snack"){ if(!(spot.meal==="snack")) return false; }
      else if(spot.meal!==state.meal) return false;
    }
    if(state.hideChecked && isChecked(spot.id)) return false;
    if(state.q){
      var hay=(spot.name+" "+spot.tag+" "+spot.area+" "+spot.city+" "+(spot.note||"")).toLowerCase();
      if(hay.indexOf(state.q)===-1) return false;
    }
    return true;
  }

  /* ---------- card render ---------- */
  function spotCard(spot, opts){
    opts=opts||{};
    var c=el("div","card"+(isChecked(spot.id)?" checked":""));
    c.setAttribute("data-id",spot.id);

    var mealCls="meal-"+(spot.meal||"anytime");
    if(opts.mealOverride){ mealCls="meal-"+opts.mealOverride; }
    c.appendChild(el("div","meal-badge "+mealCls, esc(opts.mealOverride||spot.meal||"")));

    var row1=el("div","row1");
    if(spot.meal!=="attraction"){
      var cw=el("label","chkwrap");
      var cb=el("input"); cb.type="checkbox"; cb.checked=isChecked(spot.id);
      cb.addEventListener("change",function(){ setChecked(spot.id,cb.checked); c.classList.toggle("checked",cb.checked); });
      cw.appendChild(cb); row1.appendChild(cw);
    }
    var head=el("div");
    head.appendChild(el("div","name",esc(spot.name)));
    if(spot.tag) head.appendChild(el("div","tag",esc(spot.tag)));
    row1.appendChild(head);
    c.appendChild(row1);

    // best dish
    if(spot.best) c.appendChild(el("div","best","⭐ "+esc(spot.best)));

    // distance
    var d=opts.distText!=null?opts.distText:distLabel(spot); if(d) c.appendChild(el("div","dist",d));

    // reservation flag
    if(spot.reservation==="required") c.appendChild(el("div","resv resv-required","RESERVE / TICKET NEEDED"));
    else if(spot.reservation==="recommended") c.appendChild(el("div","resv resv-recommended","Booking recommended"));

    // meta
    var m=el("div","meta");
    if(spot.hours) m.appendChild(el("div","l","<span class='k'>🕑</span><span>"+esc(spot.hours)+"</span>"));
    if(spot.closed) m.appendChild(el("div","l","<span class='k'>📅</span><span class='"+(/open daily|follows|none/i.test(spot.closed)?"":"closed")+"'>"+esc(spot.closed)+"</span>"));
    if(spot.station) m.appendChild(el("div","l","<span class='k'>🚉</span><span>"+esc(spot.station)+"</span>"));
    if(spot.area) m.appendChild(el("div","l","<span class='k'>📌</span><span>"+esc(spot.area)+(spot.city?", "+esc(spot.city):"")+"</span>"));
    c.appendChild(m);

    if(spot.note){
      var warn=(spot.coords==="low"||/unverified|couldn't verify|verify/i.test(spot.note));
      c.appendChild(el("div","note"+(warn?" ":""),(warn?"<span class='flagwarn'>⚠︎ </span>":"")+esc(spot.note)));
    }

    // actions
    var act=el("div","actions");
    var nav=el("a","btn nav","Navigate ↗"); nav.href=mapsUrl(spot.maps||((spot.name)+" "+(spot.area||"")+" "+(spot.city||""))); nav.target="_blank"; nav.rel="noopener";
    act.appendChild(nav);
    var ph=el("a","btn photos","Photos ↗"); ph.href=photosUrl(photoQuery(spot)); ph.target="_blank"; ph.rel="noopener";
    act.appendChild(ph);
    c.appendChild(act);
    return c;
  }

  function miniCard(spot, mealOverride){ return spotCard(spot,{mealOverride:mealOverride}); }

  /* ---------- HOTELS render ---------- */
  function fmtDate(iso){
    var d=new Date(iso+"T00:00:00");
    return d.toLocaleDateString("en-AU",{weekday:"short",day:"numeric",month:"short"});
  }
  function hotelCard(h, idx){
    var c=el("div","card hotel"); c.setAttribute("data-hotel",h.id);
    var badge=idx!=null?"<span class='hnum'>🏨 "+idx+"</span> ":"";
    c.appendChild(el("div","row1","<div><div class='name'>"+badge+esc(h.name)+"</div><div class='tag'>"+esc(h.area)+"</div></div>"));
    c.appendChild(el("div","dates",fmtDate(h.checkin)+" → "+fmtDate(h.checkout)+" <span class='nights'>· "+h.nights+" night"+(h.nights>1?"s":"")+"</span>"));
    var m=el("div","meta");
    m.appendChild(el("div","l","<span class='k'>🕑</span><span>Check-in "+esc(h.checkinTime)+" · out "+esc(h.checkoutTime)+"</span>"));
    m.appendChild(el("div","l","<span class='k'>📌</span><span>"+esc(h.address)+"</span>"));
    m.appendChild(el("div","l","<span class='k'>☎︎</span><span>"+esc(h.phone||"")+"</span>"));
    m.appendChild(el("div","l","<span class='k'>#</span><span>Conf "+esc(h.conf)+(h.pin?" · PIN "+esc(h.pin):"")+"</span>"));
    c.appendChild(m);
    if(h.note) c.appendChild(el("div","note",esc(h.note)));
    var act=el("div","actions");
    var nav=el("a","btn nav","Navigate ↗"); nav.href=mapsUrl(h.maps||h.address); nav.target="_blank"; nav.rel="noopener"; act.appendChild(nav);
    if(h.pdf){ var p=el("a","btn pdf","Confirmation ↗"); p.href=h.pdf; p.target="_blank"; p.rel="noopener"; act.appendChild(p); }
    c.appendChild(act);
    return c;
  }

  /* ---------- BY HOTEL view ---------- */
  /* every spot is bucketed under the closest hotel, so each stay shows
     what's worth visiting nearby, sorted by distance. */
  function renderByHotel(container){
    container.appendChild(el("div","sec-h","Food near each hotel — in stay order"));
    // bucket spots by nearest hotel id
    var buckets={};
    SPOTS.forEach(function(s){
      if(!matches(s)) return;
      var n=nearestHotel(s); if(!n.hotel) return;
      (buckets[n.hotel.id]=buckets[n.hotel.id]||[]).push({spot:s, km:n.km});
    });
    var shown=0;
    HOTELS.forEach(function(h,i){
      var arr=buckets[h.id]||[];
      arr.sort(function(a,b){ return a.km-b.km; });
      var head=el("div","hotelgroup");
      head.appendChild(hotelCard(h, i+1));
      head.appendChild(el("div","grp-h","<span class='area'>● "+arr.length+" spot"+(arr.length===1?"":"s")+" nearest this hotel</span>"));
      var grid=el("div","cards");
      arr.forEach(function(o){
        var km=o.km, walk=Math.round(km*1000/80);
        var kmTxt=km<1?Math.round(km*1000)+" m":km.toFixed(1)+" km";
        var w=walk<=35?" · ~"+walk+" min walk":"";
        grid.appendChild(spotCard(o.spot,{distText:"📍 "+kmTxt+w+" from hotel"}));
      });
      head.appendChild(grid);
      container.appendChild(head);
      shown+=arr.length;
    });
    if(shown===0) container.appendChild(el("div","note","No spots match this filter."));
  }

  /* ---------- DAY view ---------- */
  var MEAL_SLOTS=["breakfast","lunch","snack","dinner","attraction","anytime"];
  function renderDays(container){
    container.appendChild(el("div","sec-h","Suggested day-by-day plan"));
    container.appendChild(el("div","note","A flexible starting point — clustered near each day's hotel and mindful of closing days. Switch to “By area” to see every spot. Reserve-ahead places are flagged."));
    var prevHotel=null;
    ITINERARY.forEach(function(day){
      var hotel=HOTELS.filter(function(h){return h.id===day.hotel;})[0];
      var firstOfStay=(day.hotel!==prevHotel); prevHotel=day.hotel;
      var wrap=el("div","day");
      var dh=el("div","dhead");
      dh.appendChild(el("div","d1","<span class='date'>"+fmtDate(day.date)+"</span><span class='htl'>🏨 "+esc(hotel?hotel.name:"")+"</span>"));
      dh.appendChild(el("div","title",esc(day.title||"")));
      if(day.note) dh.appendChild(el("div","dnote",esc(day.note)));
      if(day.tickets){
        var tb=el("div","ticketbar");
        (day.tickets.express||[]).forEach(function(t){ var a=el("a","tkt express","🎟 "+esc(t.label)); a.href=t.pdf; a.target="_blank"; a.rel="noopener"; tb.appendChild(a); });
        (day.tickets.entry||[]).forEach(function(t){ var a=el("a","tkt entry","🎫 "+esc(t.label)); a.href=t.pdf; a.target="_blank"; a.rel="noopener"; tb.appendChild(a); });
        dh.appendChild(tb);
      }
      wrap.appendChild(dh);
      var items=el("div","ditems");
      // order by meal slot
      var sorted=day.items.slice().sort(function(a,b){ return MEAL_SLOTS.indexOf(a.meal)-MEAL_SLOTS.indexOf(b.meal); });
      var any=false;
      sorted.forEach(function(it){
        if(state.meal!=="all" && it.meal!==state.meal) return;
        var sp=it.spot?spotById[it.spot]:null;
        if(!sp){
          if(!it.text || state.q) return; // free-text note (e.g. hotel breakfast)
          any=true;
          var slotN=el("div","slot");
          slotN.appendChild(el("div","when",it.meal));
          var boxN=el("div","mini"); var noteCard=el("div","card noteonly");
          noteCard.appendChild(el("div","name","🏨 "+esc(it.text)));
          boxN.appendChild(noteCard); slotN.appendChild(boxN); items.appendChild(slotN);
          return;
        }
        if(state.hideChecked && isChecked(sp.id)) return;
        if(state.q){ var hay=(sp.name+" "+sp.tag+" "+sp.area).toLowerCase(); if(hay.indexOf(state.q)===-1) return; }
        any=true;
        var slot=el("div","slot");
        slot.appendChild(el("div","when",it.meal));
        var mini=el("div","mini"); mini.appendChild(miniCard(sp,it.meal));
        slot.appendChild(mini);
        items.appendChild(slot);
      });
      if(!any){ items.appendChild(el("div","note","No items match the current filter for this day.")); }
      wrap.appendChild(items);
      // Megan mode: shopping near this hotel (once per stay)
      if(state.megan && firstOfStay && hotel){
        var shh=hotel.name.replace(/^(Hotel |THE |Keisei Richmond Hotel )/i,"").split(",")[0];
        var sn=SHOPLIST.filter(shopMatches).filter(function(s){ return s.city===hotel.city; })
          .map(function(s){ return {s:s, km:haversine(s.lat,s.lng,hotel.lat,hotel.lng)}; })
          .sort(function(a,b){ return a.km-b.km; }).slice(0,8);
        if(sn.length){
          var sblock=el("div","day-shops");
          sblock.appendChild(el("div","shop-sec-h","🛍 Shopping near "+esc(shh)));
          var sg=el("div","cards");
          sn.forEach(function(o){
            var kmTxt=o.km<1?Math.round(o.km*1000)+" m":o.km.toFixed(1)+" km";
            var walk=Math.round(o.km*1000/80), w=walk<=35?" · ~"+walk+" min walk":"";
            sg.appendChild(shopCard(o.s,{distText:"📍 "+kmTxt+w+" from hotel"}));
          });
          sblock.appendChild(sg); wrap.appendChild(sblock);
        }
      }
      container.appendChild(wrap);
    });
    // catch-all: anything not pinned to a specific day, so nothing is missed
    var placed={};
    ITINERARY.forEach(function(d){ d.items.forEach(function(it){ if(it.spot) placed[it.spot]=1; }); });
    var rest=SPOTS.filter(function(s){ return !placed[s.id] && matches(s); });
    if(rest.length){
      container.appendChild(el("div","sec-h","Not pinned to a day · "+rest.length+" more on your list"));
      container.appendChild(el("div","note","On your shortlist but not slotted into a specific day — grab these when you're nearby (use the map or “Near me”). Filtered by your current meal/search selection."));
      rest.sort(function(a,b){ return (a.city+a.area+a.name).localeCompare(b.city+b.area+b.name); });
      var rgrid=el("div","cards");
      rest.forEach(function(s){ rgrid.appendChild(spotCard(s)); });
      container.appendChild(rgrid);
    }
  }

  /* ---------- MAP view ---------- */
  var MEAL_COLORS={ breakfast:"#b26a00", lunch:"#1666c4", dinner:"#7b3fb5", snack:"#c2366b", anytime:"#3a7a4f", attraction:"#6b6b70" };
  var MAP=null, markerLayer=null, mapFocus="tokyo";
  var markersById={}, hotelMarkerById={}, shopMarkerById={}, curHL=null;

  function ensureMap(){
    if(MAP || typeof L==="undefined") return;
    MAP=L.map("map",{ zoomControl:true }).setView([35.68,139.76],12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
      maxZoom:19, attribution:"&copy; OpenStreetMap contributors"
    }).addTo(MAP);
    markerLayer=L.layerGroup().addTo(MAP);
    MAP.on("popupopen", function(e){
      var node=e.popup.getElement(); if(!node) return;
      var btn=node.querySelector("button[data-toggle]");
      if(btn){ btn.addEventListener("click", function(){
        var id=btn.getAttribute("data-toggle"); var now=!isChecked(id);
        setChecked(id, now); refreshMarkers(); MAP.closePopup();
      }); }
    });
  }

  function popupHtml(spot){
    var h="<div class='pop'><div class='pname'>"+esc(spot.name)+"</div>";
    if(spot.tag) h+="<div class='ptag'>"+esc(spot.tag)+"</div>";
    if(spot.best) h+="<div class='pbest'>⭐ "+esc(spot.best)+"</div>";
    if(spot.hours) h+="<div class='pmeta'>🕑 "+esc(spot.hours)+"</div>";
    if(spot.closed) h+="<div class='pmeta "+(/open daily|follows|none/i.test(spot.closed)?"":"closed")+"'>📅 "+esc(spot.closed)+"</div>";
    if(spot.station) h+="<div class='pmeta'>🚉 "+esc(spot.station)+"</div>";
    var d=distLabel(spot); if(d) h+="<div class='pmeta'>"+esc(d)+"</div>";
    if(spot.reservation==="required") h+="<div class='pmeta closed'>Reserve / ticket needed</div>";
    else if(spot.reservation==="recommended") h+="<div class='pmeta'>Booking recommended</div>";
    var nav=mapsUrl(spot.maps||((spot.name)+" "+(spot.area||"")+" "+(spot.city||"")));
    h+="<div class='pact'><a class='nav' target='_blank' rel='noopener' href='"+nav+"'>Navigate ↗</a>";
    h+="<a target='_blank' rel='noopener' href='"+photosUrl(photoQuery(spot))+"'>Photos ↗</a>";
    if(spot.meal!=="attraction") h+="<button data-toggle='"+esc(spot.id)+"'>"+(isChecked(spot.id)?"Untick":"Tick off")+"</button>";
    h+="</div></div>";
    return h;
  }

  function hotelPopupHtml(h){
    var nav=mapsUrl(h.maps||h.address);
    var s="<div class='pop'><div class='pname'>🏨 "+esc(h.name)+"</div>";
    s+="<div class='ptag'>"+esc(h.area)+"</div>";
    s+="<div class='pmeta'>"+fmtDate(h.checkin)+" → "+fmtDate(h.checkout)+" · "+h.nights+" night"+(h.nights>1?"s":"")+"</div>";
    s+="<div class='pmeta'>📌 "+esc(h.address)+"</div>";
    s+="<div class='pact'><a class='nav' target='_blank' rel='noopener' href='"+nav+"'>Navigate ↗</a>";
    if(h.pdf) s+="<a target='_blank' rel='noopener' href='"+h.pdf+"'>Confirmation ↗</a>";
    s+="</div></div>";
    return s;
  }

  function hotelIcon(idx){
    return L.divIcon({ className:"hotelpin", html:"🏨 "+idx, iconSize:[32,22], iconAnchor:[16,11], popupAnchor:[0,-12] });
  }

  function shopPopupHtml(s){
    var h="<div class='pop'><div class='pname'>🛍 "+esc(s.name)+"</div>";
    if(s.cat) h+="<div class='ptag'>"+esc(s.cat)+"</div>";
    if(s.good) h+="<div class='pbest'>⭐ "+esc(s.good)+"</div>";
    if(s.hours) h+="<div class='pmeta'>🕑 "+esc(s.hours)+"</div>";
    if(s.station) h+="<div class='pmeta'>🚉 "+esc(s.station)+"</div>";
    var d=distLabel(s); if(d) h+="<div class='pmeta'>"+esc(d)+"</div>";
    h+="<div class='pact'><a class='nav' target='_blank' rel='noopener' href='"+mapsUrl(s.maps||s.name)+"'>Navigate ↗</a>";
    h+="<a target='_blank' rel='noopener' href='"+photosUrl(s.maps||s.name)+"'>Photos ↗</a></div></div>";
    return h;
  }
  function shopIcon(){ return L.divIcon({ className:"shoppin", html:"🛍", iconSize:[24,24], iconAnchor:[12,12], popupAnchor:[0,-10] }); }

  function refreshMarkers(){
    if(!MAP || !markerLayer) return;
    markerLayer.clearLayers(); markersById={}; hotelMarkerById={}; shopMarkerById={}; curHL=null;
    var pts={tokyo:[], osaka:[], all:[]};
    if(state.megan){
      SHOPLIST.forEach(function(s){
        if(!shopMatches(s)) return;
        var m=L.marker([s.lat,s.lng],{ icon:shopIcon() });
        m.bindPopup(shopPopupHtml(s));
        m.bindTooltip(s.name,{direction:"top",offset:[0,-8]});
        m.addTo(markerLayer); shopMarkerById[s.id]=m;
        var key=(s.city||"").toLowerCase(); if(pts[key]) pts[key].push([s.lat,s.lng]); pts.all.push([s.lat,s.lng]);
      });
    }
    HOTELS.forEach(function(h,i){
      var m=L.marker([h.lat,h.lng],{ icon:hotelIcon(i+1), zIndexOffset:1000 });
      m.bindPopup(hotelPopupHtml(h));
      m.bindTooltip(h.name,{direction:"top",offset:[0,-12]});
      m.addTo(markerLayer); hotelMarkerById[h.id]=m;
      var key=(h.city||"").toLowerCase(); if(pts[key]) pts[key].push([h.lat,h.lng]); pts.all.push([h.lat,h.lng]);
    });
    SPOTS.forEach(function(s){
      if(!matches(s)) return;
      var done=isChecked(s.id);
      var m=L.circleMarker([s.lat,s.lng],{
        radius:6.5, color:"#fff", weight:2,
        fillColor:MEAL_COLORS[s.meal]||"#3a7a4f", fillOpacity: done?0.35:1
      });
      m._baseFill=MEAL_COLORS[s.meal]||"#3a7a4f";
      m.bindPopup(popupHtml(s));
      m.bindTooltip(s.name,{direction:"top",offset:[0,-6]});
      m.addTo(markerLayer); markersById[s.id]=m;
      var key=(s.city||"").toLowerCase(); if(pts[key]) pts[key].push([s.lat,s.lng]); pts.all.push([s.lat,s.lng]);
    });
    MAP._pts=pts;
    applyFocus();
  }

  function applyFocus(){
    if(!MAP || !MAP._pts) return;
    var arr=MAP._pts[mapFocus]&&MAP._pts[mapFocus].length?MAP._pts[mapFocus]:MAP._pts.all;
    if(arr && arr.length){ MAP.fitBounds(L.latLngBounds(arr).pad(0.15)); }
  }

  /* highlight a marker when its card is hovered */
  function setHL(id,on){
    var m=markersById[id];
    if(m){
      if(on){ m.setStyle({radius:11, weight:3, color:"#1c1c1e"}); m.bringToFront(); m.openTooltip(); }
      else  { m.setStyle({radius:6.5, weight:2, color:"#fff"}); m.closeTooltip(); }
      return;
    }
    var hm=hotelMarkerById[id]||shopMarkerById[id];
    if(hm){ var elx=hm.getElement(); if(elx) elx.classList.toggle("mk-hl",on); if(on) hm.openTooltip(); else hm.closeTooltip(); }
  }
  function hoverOn(id){ if(id===curHL) return; if(curHL) setHL(curHL,false); curHL=id; setHL(id,true); }
  function hoverOff(){ if(curHL){ setHL(curHL,false); curHL=null; } }

  /* click a card to fly to + open its marker */
  function locate(id){
    var m=markersById[id]||hotelMarkerById[id]||shopMarkerById[id]; if(!m||!MAP) return;
    if(isMobile()) setSheet("collapsed");   // reveal the map
    MAP.flyTo(m.getLatLng(), Math.max(MAP.getZoom(),15), {duration:0.5});
    setTimeout(function(){ m.openPopup(); },500);
  }

  function isMobile(){ return window.matchMedia("(max-width:820px)").matches; }

  /* ---- mobile bottom-sheet ---- */
  var sheetSnap="collapsed";
  function sheetEl(){ return document.getElementById("sheet"); }
  function sheetCollapsedY(){ var s=sheetEl(); return s?Math.max(0, s.clientHeight-86):0; }
  function applySheetSnap(){
    var s=sheetEl(); if(!s) return;
    s.style.transform="translateY("+(sheetSnap==="expanded"?0:sheetCollapsedY())+"px)";
    var lbl=document.getElementById("sheetLbl");
    if(lbl) lbl.textContent = sheetSnap==="expanded" ? "▾ Slide down for map" : "▴ Slide up for list";
  }
  function setSheet(state){ sheetSnap=state; if(isMobile()) applySheetSnap(); }
  function setupSheet(){
    var s=sheetEl(), h=document.getElementById("sheetHandle"); if(!s||!h) return;
    var startY=0, startT=0, dragging=false, moved=false;
    function cy(){ var m=/translateY\(([-0-9.]+)px\)/.exec(s.style.transform); return m?parseFloat(m[1]):sheetCollapsedY(); }
    function down(e){ if(!isMobile()) return; dragging=true; moved=false; s.classList.add("dragging"); startY=(e.touches?e.touches[0].clientY:e.clientY); startT=cy(); }
    function move(e){ if(!dragging) return; var y=(e.touches?e.touches[0].clientY:e.clientY), dy=y-startY; if(Math.abs(dy)>5) moved=true; var ny=Math.max(0,Math.min(sheetCollapsedY(), startT+dy)); s.style.transform="translateY("+ny+"px)"; if(e.cancelable && e.preventDefault) e.preventDefault(); }
    function up(){ if(!dragging) return; dragging=false; s.classList.remove("dragging"); if(!moved){ setSheet(sheetSnap==="expanded"?"collapsed":"expanded"); return; } setSheet(cy() < sheetCollapsedY()*0.5 ? "expanded" : "collapsed"); }
    h.addEventListener("touchstart",down,{passive:true});
    h.addEventListener("touchmove",move,{passive:false});
    h.addEventListener("touchend",up);
    h.addEventListener("mousedown",down); window.addEventListener("mousemove",move); window.addEventListener("mouseup",up);
  }

  function sizeMap(){
    var hdr=document.querySelector("header.top");
    var ctrls=document.querySelector(".controls");
    var pane=document.getElementById("mappane");
    var mapDiv=document.getElementById("map");
    var s=sheetEl();
    if(isMobile()){
      var vh=(window.visualViewport && window.visualViewport.height) ? window.visualViewport.height : window.innerHeight;
      var mtop=(hdr?hdr.offsetHeight:60)+(ctrls?ctrls.offsetHeight:0);
      var mh=Math.max(220, Math.round(vh - mtop));
      document.documentElement.style.setProperty("--mtop", mtop+"px");
      if(pane){ pane.style.top=mtop+"px"; pane.style.height=mh+"px"; }
      if(mapDiv) mapDiv.style.height=mh+"px";   // explicit px so Leaflet fills
      applySheetSnap();
    } else {
      document.documentElement.style.removeProperty("--mtop");
      if(s) s.style.transform="";
      var top=(hdr?hdr.offsetHeight:120)+8;
      if(pane){ pane.style.top=top+"px"; pane.style.height=""; }
      if(mapDiv) mapDiv.style.height=Math.max(360, window.innerHeight - top - 20)+"px";
    }
    if(MAP) MAP.invalidateSize();
  }

  /* ---------- SHOPPING (Megan mode) ---------- */
  function shopMatches(s){
    if(state.q){
      var hay=(s.name+" "+s.cat+" "+s.area+" "+s.cluster+" "+(s.good||"")).toLowerCase();
      if(hay.indexOf(state.q)===-1) return false;
    }
    return true;
  }
  function shopCard(shop, opts){
    opts=opts||{};
    var c=el("div","card shopcard"); c.setAttribute("data-shop",shop.id);
    c.appendChild(el("div","meal-badge shop-badge","SHOP"));
    var head=el("div");
    head.appendChild(el("div","name",esc(shop.name)));
    if(shop.cat) head.appendChild(el("div","tag",esc(shop.cat)));
    var row1=el("div","row1"); row1.appendChild(head); c.appendChild(row1);
    if(shop.good) c.appendChild(el("div","best","⭐ "+esc(shop.good)));
    var d=opts.distText!=null?opts.distText:distLabel(shop); if(d) c.appendChild(el("div","dist",d));
    var m=el("div","meta");
    if(shop.hours) m.appendChild(el("div","l","<span class='k'>🕑</span><span>"+esc(shop.hours)+"</span>"));
    if(shop.closed) m.appendChild(el("div","l","<span class='k'>📅</span><span class='"+(/open daily|varies|none/i.test(shop.closed)?"":"closed")+"'>"+esc(shop.closed)+"</span>"));
    if(shop.station) m.appendChild(el("div","l","<span class='k'>🚉</span><span>"+esc(shop.station)+"</span>"));
    if(shop.area) m.appendChild(el("div","l","<span class='k'>📌</span><span>"+esc(shop.area)+", "+esc(shop.city)+"</span>"));
    c.appendChild(m);
    var act=el("div","actions");
    var nav=el("a","btn nav","Navigate ↗"); nav.href=mapsUrl(shop.maps||shop.name); nav.target="_blank"; nav.rel="noopener"; act.appendChild(nav);
    var ph=el("a","btn photos","Photos ↗"); ph.href=photosUrl(shop.maps||shop.name); ph.target="_blank"; ph.rel="noopener"; act.appendChild(ph);
    c.appendChild(act);
    return c;
  }
  function renderShops(container){
    var list=SHOPLIST.filter(shopMatches);
    container.appendChild(el("div","sec-h","🛍 Shopping — Megan mode"));
    if(list.length===0){ container.appendChild(el("div","note","No shops match this filter.")); return; }
    if(state.view==="near" && userPos){
      var arr=list.map(function(s){ return {s:s, km:distFromUser(s)}; }).sort(function(a,b){ return a.km-b.km; });
      var grid0=el("div","cards");
      arr.forEach(function(o){
        var walk=Math.round(o.km*1000/80), w=o.km<3?" · ~"+walk+" min walk":"";
        grid0.appendChild(shopCard(o.s,{distText:"📍 "+kmText(o.km)+w+" from you"}));
      });
      container.appendChild(grid0); return;
    }
    // group by city -> cluster, preserving array (ranked) order
    var cities=[], byCity={};
    list.forEach(function(s){ if(!byCity[s.city]){ byCity[s.city]=[]; cities.push(s.city); } byCity[s.city].push(s); });
    cities.forEach(function(city){
      container.appendChild(el("div","grp-h","<span class='city'>"+esc(city)+"</span><span class='area'>"+byCity[city].length+" shops</span>"));
      var clusters=[], byCl={};
      byCity[city].forEach(function(s){ var k=s.cluster||s.area; if(!byCl[k]){ byCl[k]=[]; clusters.push(k); } byCl[k].push(s); });
      clusters.forEach(function(k){
        container.appendChild(el("div","grp-h","<span class='area'>● "+esc(k)+"</span>"));
        var grid=el("div","cards");
        byCl[k].forEach(function(s){ grid.appendChild(shopCard(s)); });
        container.appendChild(grid);
      });
    });
  }

  /* ---------- GEOLOCATION / Near me ---------- */
  var userMarker=null, userAccCircle=null, geoBusy=false;
  function kmText(km){ return km<1?Math.round(km*1000)+" m":km.toFixed(km<10?1:0)+" km"; }
  function distFromUser(s){ return haversine(userPos.lat,userPos.lng,s.lat,s.lng); }

  function updateUserMarker(recenter){
    if(!MAP || !userPos || typeof L==="undefined") return;
    if(userMarker){ MAP.removeLayer(userMarker); }
    if(userAccCircle){ MAP.removeLayer(userAccCircle); }
    if(userPos.acc){ userAccCircle=L.circle([userPos.lat,userPos.lng],{radius:userPos.acc, color:"#1666c4", weight:1, opacity:.4, fillColor:"#1666c4", fillOpacity:.10}).addTo(MAP); }
    userMarker=L.circleMarker([userPos.lat,userPos.lng],{ radius:8, color:"#fff", weight:3, fillColor:"#1666c4", fillOpacity:1 }).addTo(MAP);
    userMarker.bindTooltip("You are here",{direction:"top",offset:[0,-6]});
    if(recenter){ MAP.flyTo([userPos.lat,userPos.lng], Math.max(MAP.getZoom(),15), {duration:0.6}); }
  }

  function requestLocation(recenter){
    if(geoBusy) return;
    if(!navigator.geolocation){ geoStatus="Location not supported on this device."; if(state.view==="near") render(); return; }
    geoBusy=true; geoStatus="Finding your location…"; if(state.view==="near") render();
    navigator.geolocation.getCurrentPosition(function(pos){
      geoBusy=false;
      userPos={ lat:pos.coords.latitude, lng:pos.coords.longitude, acc:pos.coords.accuracy };
      geoStatus="";
      updateUserMarker(recenter!==false);
      if(state.view==="near") render();
    }, function(err){
      geoBusy=false;
      geoStatus = err.code===1 ? "Location permission denied — enable it in your browser settings to use Near me."
                : err.code===3 ? "Location timed out — try again."
                : "Couldn't get your location.";
      if(state.view==="near") render();
    }, { enableHighAccuracy:true, timeout:12000, maximumAge:30000 });
  }

  function renderNear(container){
    var bar=el("div","nearbar");
    var btn=el("button","nearbtn", userPos?"↻ Update my location":"📍 Use my location");
    btn.addEventListener("click",function(){ requestLocation(true); });
    bar.appendChild(btn);
    if(geoStatus) bar.appendChild(el("span","nearstatus",esc(geoStatus)));
    else if(userPos) bar.appendChild(el("span","nearstatus","Showing closest first"+(userPos.acc?" · ±"+Math.round(userPos.acc)+" m":"")));
    container.appendChild(bar);

    if(!userPos){
      container.appendChild(el("div","note","Tap “Use my location” to see the shortlist sorted by what's closest to you right now. Your location stays on your device — it's only used to measure distances."));
      return;
    }
    var arr=[];
    SPOTS.forEach(function(s){ if(!matches(s)) return; arr.push({spot:s, km:distFromUser(s)}); });
    arr.sort(function(a,b){ return a.km-b.km; });
    if(arr.length===0){ container.appendChild(el("div","note","No spots match this filter.")); return; }
    container.appendChild(el("div","sec-h","Closest to you now"));
    var grid=el("div","cards");
    arr.forEach(function(o){
      var walk=Math.round(o.km*1000/80);
      var w=o.km<3?" · ~"+walk+" min walk":"";
      grid.appendChild(spotCard(o.spot,{distText:"📍 "+kmText(o.km)+w+" from you"}));
    });
    container.appendChild(grid);
  }

  /* ---------- main render ---------- */
  function render(){
    var main=document.getElementById("main");
    main.innerHTML="";
    if(state.view==="day") renderDays(main);
    else if(state.view==="near") renderNear(main);
    else renderByHotel(main);
    if(state.megan && state.view!=="day") renderShops(main); // day view weaves shops per hotel
    refreshMarkers();
    updateProgress();
  }

  /* ---------- wire controls ---------- */
  function initApp(){
    ready(function(){
      // tab buttons
      document.querySelectorAll(".tabs button").forEach(function(b){
        b.addEventListener("click",function(){
          state.view=b.getAttribute("data-view");
          try{ localStorage.setItem("japan26_view",state.view); }catch(e){}
          document.querySelectorAll(".tabs button").forEach(function(x){x.classList.toggle("active",x===b);});
          render();
          if(isMobile()) setSheet("expanded");
          if(state.view==="near" && !userPos && !geoBusy) requestLocation(true);
        });
        b.classList.toggle("active", b.getAttribute("data-view")===state.view);
      });
      // locate-me button on the map
      var lb=document.getElementById("locateBtn");
      if(lb) lb.addEventListener("click",function(){ requestLocation(true); });

      // Megan mode toggle + toilet button
      var mt=document.getElementById("meganToggle");
      function reflectMegan(){
        if(mt) mt.classList.toggle("on", state.megan);
        var tb=document.getElementById("toiletBtn"); if(tb) tb.classList.toggle("hidden", !state.megan);
      }
      if(mt) mt.addEventListener("click", function(){
        state.megan=!state.megan;
        try{ localStorage.setItem("japan26_megan", state.megan?"1":"0"); }catch(e){}
        reflectMegan(); render();
        if(isMobile()) setSheet("expanded");
      });
      reflectMegan();
      var toi=document.getElementById("toiletBtn");
      if(toi) toi.addEventListener("click", function(){
        var url = userPos
          ? "https://www.google.com/maps/search/public+toilet/@"+userPos.lat+","+userPos.lng+",17z"
          : "https://www.google.com/maps/search/?api=1&query=public%20toilet%20near%20me";
        if(!userPos) requestLocation(false);
        window.open(url, "_blank", "noopener");
      });
      // meal chips
      document.querySelectorAll(".chip").forEach(function(ch){
        ch.addEventListener("click",function(){
          var m=ch.getAttribute("data-meal");
          state.meal=(state.meal===m)?"all":m;
          document.querySelectorAll(".chip").forEach(function(x){ x.classList.toggle("on", x.getAttribute("data-meal")===state.meal); });
          render();
        });
      });
      // map focus buttons
      document.querySelectorAll(".mapfocus button").forEach(function(b){
        b.classList.toggle("on", b.getAttribute("data-focus")===mapFocus);
        b.addEventListener("click",function(){
          mapFocus=b.getAttribute("data-focus");
          document.querySelectorAll(".mapfocus button").forEach(function(x){ x.classList.toggle("on", x===b); });
          applyFocus();
        });
      });
      // search
      var s=document.getElementById("search");
      if(s) s.addEventListener("input",function(){ state.q=s.value.trim().toLowerCase(); render(); });
      // hide checked
      var hc=document.getElementById("hidechecked");
      if(hc) hc.addEventListener("change",function(){ state.hideChecked=hc.checked; render(); });

      // hover-to-highlight + click-to-locate (event delegation on the list)
      var listEl=document.getElementById("main");
      function idFrom(t){ if(!t||!t.closest) return null; var c=t.closest("[data-id],[data-hotel],[data-shop]"); return c?(c.getAttribute("data-id")||c.getAttribute("data-hotel")||c.getAttribute("data-shop")):null; }
      listEl.addEventListener("mouseover",function(e){ var id=idFrom(e.target); if(id) hoverOn(id); });
      listEl.addEventListener("mouseleave",hoverOff);
      listEl.addEventListener("click",function(e){
        if(e.target.closest("a,button,input,label")) return;
        var id=idFrom(e.target); if(id) locate(id);
      });

      // build the map first, then render the list (render() plots markers)
      ensureMap(); setupSheet(); sizeMap();
      window.addEventListener("resize", sizeMap);
      window.addEventListener("orientationchange", function(){ setTimeout(sizeMap,250); });
      if(window.visualViewport) window.visualViewport.addEventListener("resize", sizeMap);
      render();
      setTimeout(sizeMap, 120);
      setTimeout(sizeMap, 600);
      if(state.view==="near" && !userPos) requestLocation(true);
    });
  }

  // expose for inline onload fallback
  window.__japanInit=initApp;

  // start straight away (no password gate)
  ready(initApp);
})();
